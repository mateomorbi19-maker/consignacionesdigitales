/**
 * Surcars · Aviso por email de cada envío nuevo de consignación.
 *
 * Sin dependencias: habla SMTP directo (TLS en el puerto 465, o STARTTLS en el 587).
 * Se activa con variables de entorno, nunca en el código (el repositorio es público):
 *   AVISO_EMAIL       a quién avisar (uno o varios, separados por coma)
 *   SMTP_HOST         servidor SMTP (Gmail: smtp.gmail.com)
 *   SMTP_PORT         465 (recomendado) o 587
 *   SMTP_USER         cuenta que envía (Gmail: tu dirección)
 *   SMTP_PASS         clave de esa cuenta (Gmail: una "contraseña de aplicación", no la de tu cuenta)
 *   AVISO_REMITENTE   opcional: nombre del remitente (por defecto "Surcars · Consignaciones")
 *
 * El aviso sale después de guardar el envío: si el mail falla, el envío queda guardado igual
 * y el error queda anotado en la consola del servidor.
 */

import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';

const TIEMPO_MAXIMO_MS = 20000; // sin respuesta del servidor SMTP durante este tiempo, se corta
const ESPERA_REINTENTO_MS = 20000;
const ADJUNTOS_MAXIMOS = 18 * 1024 * 1024; // Gmail acepta 25 MB por mail (con la codificación incluida)

// Paleta "Neón" de Surcars (ver CLAUDE.md). Los clientes de correo no leen variables CSS: se centraliza acá.
const COLOR = {
  fondo: '#06070B',
  tarjeta: '#0F1116',
  linea: '#23262E',
  texto: '#EDEFF5',
  texto2: '#B8BBC3',
  texto3: '#8E9199',
  azul: '#3557FF',
};
const FUENTE = "Manrope, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const TIPOS_REPARACION = { mecanica: 'mecánica', estetica: 'estética' };
const TIPOS_IMAGEN = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' };

/* ------------------------------------------------------------------ */
/* Configuración                                                       */
/* ------------------------------------------------------------------ */

const direccionValida = (valor) => /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]{2,}$/.test(valor);
const unaLinea = (valor) => String(valor ?? '').replace(/[\r\n\t]+/g, ' ').trim();

/** Lee la configuración del entorno. Devuelve null si el aviso no está configurado. */
export function leerConfiguracion(entorno = process.env) {
  const para = String(entorno.AVISO_EMAIL ?? '')
    .split(',')
    .map((valor) => valor.trim())
    .filter(direccionValida);
  const host = unaLinea(entorno.SMTP_HOST);
  if (!para.length || !host) return null;
  const usuario = unaLinea(entorno.SMTP_USER);
  return {
    para,
    host,
    puerto: Number.parseInt(entorno.SMTP_PORT ?? '', 10) || 465,
    usuario,
    clave: String(entorno.SMTP_PASS ?? '').replace(/\s+/g, ''), // las contraseñas de aplicación de Gmail vienen con espacios
    de: direccionValida(usuario) ? usuario : para[0],
    nombre: unaLinea(entorno.AVISO_REMITENTE) || 'Surcars · Consignaciones',
  };
}

/** "m••••••19@gmail.com": para mostrar en la consola sin exponer la dirección completa. */
export function enmascarar(direccion) {
  const [usuario, dominio] = direccion.split('@');
  if (!dominio) return '•••';
  const visible = usuario.length <= 3 ? usuario.slice(0, 1) : `${usuario.slice(0, 1)}${'•'.repeat(Math.min(6, usuario.length - 3))}${usuario.slice(-2)}`;
  return `${visible}@${dominio}`;
}

/* ------------------------------------------------------------------ */
/* Cliente SMTP mínimo                                                 */
/* ------------------------------------------------------------------ */

class SesionSmtp {
  constructor(socket) {
    this.socket = socket;
    this.pendiente = '';
    this.lineas = [];
    this.respuestas = [];
    this.esperando = null;
    this.error = null;
    this.alDatos = (trozo) => {
      this.pendiente += trozo;
      this.procesar();
    };
    this.alError = (error) => this.fallar(error);
    this.alCerrar = () => this.fallar(new Error('El servidor SMTP cerró la conexión.'));
    socket.setEncoding('utf8');
    socket.on('data', this.alDatos);
    socket.on('error', this.alError);
    socket.on('close', this.alCerrar);
  }

  /** Una respuesta termina en una línea "NNN texto"; las intermedias son "NNN-texto". */
  procesar() {
    let fin;
    while ((fin = this.pendiente.indexOf('\n')) >= 0) {
      const linea = this.pendiente.slice(0, fin).replace(/\r$/, '');
      this.pendiente = this.pendiente.slice(fin + 1);
      this.lineas.push(linea);
      if (/^\d{3}(?: |$)/.test(linea)) {
        const respuesta = { codigo: Number(linea.slice(0, 3)), texto: this.lineas.join('\n') };
        this.lineas = [];
        if (this.esperando) {
          const { resolver } = this.esperando;
          this.esperando = null;
          resolver(respuesta);
        } else {
          this.respuestas.push(respuesta);
        }
      }
    }
  }

  fallar(error) {
    if (this.error) return;
    this.error = error;
    if (this.esperando) {
      const { rechazar } = this.esperando;
      this.esperando = null;
      rechazar(error);
    }
  }

  leer() {
    if (this.respuestas.length) return Promise.resolve(this.respuestas.shift());
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolver, rechazar) => {
      this.esperando = { resolver, rechazar };
    });
  }

  async esperar(codigos, que) {
    const respuesta = await this.leer();
    if (!codigos.includes(respuesta.codigo)) {
      throw new Error(`el servidor SMTP respondió ${respuesta.codigo} a ${que}: ${respuesta.texto.replace(/\s+/g, ' ').slice(0, 200)}`);
    }
    return respuesta;
  }

  comando(linea, codigos, que) {
    this.socket.write(`${linea}\r\n`);
    return this.esperar(codigos, que ?? linea.split(' ')[0]);
  }

  /** Deja de escuchar el socket (antes de pasarlo a TLS). */
  soltar() {
    this.socket.off('data', this.alDatos);
    this.socket.off('error', this.alError);
    this.socket.off('close', this.alCerrar);
  }
}

const esLocal = (host) => ['localhost', '127.0.0.1', '::1'].includes(host);

function conectar({ host, puerto }) {
  return new Promise((resolver, rechazar) => {
    const directo = puerto === 465;
    const socket = directo ? tls.connect({ host, port: puerto, servername: host }) : net.connect({ host, port: puerto });
    socket.setTimeout(TIEMPO_MAXIMO_MS, () => socket.destroy(new Error('el servidor SMTP no respondió a tiempo')));
    socket.once(directo ? 'secureConnect' : 'connect', () => resolver(socket));
    socket.once('error', rechazar);
  });
}

function pasarATls(socket, host) {
  return new Promise((resolver, rechazar) => {
    const seguro = tls.connect({ socket, servername: host }, () => resolver(seguro));
    seguro.setTimeout(TIEMPO_MAXIMO_MS, () => seguro.destroy(new Error('el servidor SMTP no respondió a tiempo')));
    seguro.once('error', rechazar);
  });
}

/** Manda un mensaje ya armado (texto con saltos CRLF) a todos los destinatarios. */
async function enviarPorSmtp(config, mensaje) {
  let socket = await conectar(config);
  let sesion = new SesionSmtp(socket);
  try {
    await sesion.esperar([220], 'el saludo');
    const nombre = (os.hostname() || 'surcars').replace(/[^A-Za-z0-9.-]/g, '') || 'surcars';
    const ehlo = await sesion.comando(`EHLO ${nombre}`, [250]);
    if (!(socket instanceof tls.TLSSocket)) {
      if (/^250[ -]STARTTLS\b/im.test(ehlo.texto)) {
        await sesion.comando('STARTTLS', [220]);
        sesion.soltar();
        socket = await pasarATls(socket, config.host);
        sesion = new SesionSmtp(socket);
        await sesion.comando(`EHLO ${nombre}`, [250]);
      } else if (!esLocal(config.host)) {
        throw new Error('el servidor SMTP no ofrece cifrado (STARTTLS): no se manda la clave sin cifrar');
      }
    }
    if (config.usuario && config.clave) {
      const credenciales = Buffer.from(`\u0000${config.usuario}\u0000${config.clave}`, 'utf8').toString('base64');
      await sesion.comando(`AUTH PLAIN ${credenciales}`, [235], 'el usuario y la clave');
    }
    await sesion.comando(`MAIL FROM:<${config.de}>`, [250]);
    for (const para of config.para) await sesion.comando(`RCPT TO:<${para}>`, [250, 251]);
    await sesion.comando('DATA', [354]);
    // Una línea que empieza con "." se duplica (así el servidor no la toma como fin del mensaje).
    socket.write(`${mensaje.replace(/^\./gm, '..')}\r\n.\r\n`);
    await sesion.esperar([250], 'el mensaje');
    await sesion.comando('QUIT', [221]).catch(() => {});
  } finally {
    socket.end();
  }
}

/* ------------------------------------------------------------------ */
/* Armado del mensaje (MIME)                                           */
/* ------------------------------------------------------------------ */

/** Encabezado con tildes y eñes (RFC 2047), partido en palabras de hasta 75 caracteres. */
function encabezadoUtf8(texto) {
  const limpio = unaLinea(texto);
  if (/^[\x20-\x7E]*$/.test(limpio)) return limpio;
  const palabras = [];
  let trozo = '';
  for (const caracter of limpio) {
    if (Buffer.byteLength(trozo + caracter, 'utf8') > 45) {
      palabras.push(trozo);
      trozo = '';
    }
    trozo += caracter;
  }
  if (trozo) palabras.push(trozo);
  return palabras.map((parte) => `=?UTF-8?B?${Buffer.from(parte, 'utf8').toString('base64')}?=`).join('\r\n ');
}

const base64EnLineas = (contenido) => (Buffer.isBuffer(contenido) ? contenido : Buffer.from(contenido, 'utf8')).toString('base64').replace(/.{1,76}/g, '$&\r\n').trimEnd();

const escaparHtml = (texto) =>
  String(texto ?? '').replace(/[&<>"']/g, (caracter) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[caracter]);

function fechaArgentina(iso) {
  const partes = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const valor = (tipo) => partes.find((parte) => parte.type === tipo)?.value ?? '';
  return `${valor('day')}/${valor('month')}/${valor('year')} a las ${valor('hour')}:${valor('minute')}`;
}

/** Los datos del envío, ya listos para mostrar (los usan el texto plano y el HTML). */
function datosParaMostrar(registro, fotos, conAdjuntos) {
  const { vehiculo, estado, contacto, origen } = registro;
  const tomas = (registro.fotos_tomas ?? []).map((foto) => foto.toma).filter(Boolean);
  let reparacion = 'No';
  let detalle = '';
  if (estado.tuvo_golpe_o_reparacion) {
    const tipos = (estado.reparacion?.tipos ?? []).map((tipo) => TIPOS_REPARACION[tipo] ?? tipo);
    reparacion = tipos.length ? `Sí (${tipos.join(' y ')})` : 'Sí';
    detalle = estado.reparacion?.detalle ?? '';
  }
  let fotosTexto = 'Sin fotos';
  if (fotos.length) {
    const cuantas = fotos.length === 1 ? '1 foto' : `${fotos.length} fotos`;
    const donde = conAdjuntos ? 'adjuntas' : 'guardadas en el servidor (pesan demasiado para adjuntarlas)';
    fotosTexto = `${cuantas}, ${donde}${tomas.length ? `: ${tomas.join(', ')}` : ''}`;
  }
  const campania = [origen?.utm_source, origen?.utm_medium, origen?.utm_campaign].filter(Boolean).join(' · ');
  return {
    titulo: `${vehiculo.marca} ${vehiculo.modelo} ${vehiculo.anio}`,
    recibido: fechaArgentina(registro.recibido),
    filas: [
      ['Vehículo', `${vehiculo.marca} ${vehiculo.modelo}`],
      ['Versión', vehiculo.version || 'Sin especificar'],
      ['Año', String(vehiculo.anio)],
      ['Kilometraje', `${Number(estado.kilometraje).toLocaleString('es-AR')} km`],
      ['Golpes o reparaciones', reparacion],
      ['Única mano', estado.unica_mano ? 'Sí' : 'No'],
      ['Fotos', fotosTexto],
      ['Teléfono', contacto.telefono || '—'],
      ['Email', contacto.email || '—'],
      ['Origen', campania || (origen?.fbclid || origen?.gclid ? 'Anuncio (sin UTM)' : 'Sin datos de campaña')],
    ],
    detalle,
  };
}

function textoPlano(registro, datos) {
  const lineas = [
    `Nueva consignación: ${datos.titulo}`,
    `Recibida el ${datos.recibido}.`,
    '',
    ...datos.filas.map(([clave, valor]) => `${clave}: ${valor}`),
  ];
  if (datos.detalle) lineas.push('', 'Qué pasó y qué se reparó:', datos.detalle);
  lineas.push('', registro.contacto.email ? 'Para escribirle, respondé este mail.' : 'Dejó solo el teléfono.', `Envío guardado en leads/${registro.id}`);
  return lineas.join('\r\n');
}

function html(registro, datos) {
  const { contacto } = registro;
  const filas = datos.filas
    .map(
      ([clave, valor]) => `
            <tr>
              <td style="padding:11px 0;border-top:1px solid ${COLOR.linea};color:${COLOR.texto3};font-size:14px;vertical-align:top;width:42%">${escaparHtml(clave)}</td>
              <td style="padding:11px 0;border-top:1px solid ${COLOR.linea};color:${COLOR.texto};font-size:15px;font-weight:600;text-align:right;vertical-align:top">${escaparHtml(valor)}</td>
            </tr>`,
    )
    .join('');
  const detalle = datos.detalle
    ? `
          <p style="margin:18px 0 6px;color:${COLOR.texto3};font-size:14px">Qué pasó y qué se reparó</p>
          <p style="margin:0;color:${COLOR.texto2};font-size:15px;line-height:1.5">${escaparHtml(datos.detalle).replace(/\n/g, '<br>')}</p>`
    : '';
  const botones = [];
  if (contacto.telefono_digitos) {
    botones.push(
      `<a href="tel:${escaparHtml(contacto.telefono_digitos)}" style="display:inline-block;margin:0 8px 8px 0;padding:13px 20px;border-radius:12px;background:${COLOR.azul};color:${COLOR.texto};font-weight:700;font-size:15px;text-decoration:none">Llamar al ${escaparHtml(contacto.telefono)}</a>`,
    );
  }
  if (contacto.email) {
    botones.push(
      `<a href="mailto:${escaparHtml(contacto.email)}" style="display:inline-block;margin:0 8px 8px 0;padding:12px 19px;border-radius:12px;border:1px solid ${COLOR.linea};color:${COLOR.texto};font-weight:700;font-size:15px;text-decoration:none">Escribirle</a>`,
    );
  }
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>${escaparHtml(`Nueva consignación: ${datos.titulo}`)}</title></head>
<body style="margin:0;padding:0;background:${COLOR.fondo}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.fondo}">
    <tr>
      <td align="center" style="padding:28px 12px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${COLOR.tarjeta};border:1px solid ${COLOR.linea};border-radius:18px;font-family:${FUENTE};color:${COLOR.texto}">
          <tr>
            <td style="padding:28px 28px 6px">
              <h1 style="margin:0;font-size:24px;line-height:1.2;font-weight:800;letter-spacing:-0.02em;color:${COLOR.texto}">Nueva consignación: ${escaparHtml(datos.titulo)}</h1>
              <p style="margin:8px 0 0;font-size:15px;color:${COLOR.texto2}">Recibida el ${escaparHtml(datos.recibido)}.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 28px 4px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filas}
              </table>${detalle}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 16px">${botones.join('')}</td>
          </tr>
          <tr>
            <td style="padding:0 28px 26px;font-size:13px;line-height:1.5;color:${COLOR.texto3}">
              ${contacto.email ? 'Si respondés este mail, la respuesta le llega al vendedor.' : 'Dejó solo el teléfono.'}<br>
              Envío guardado en leads/${escaparHtml(registro.id)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Arma el mail completo: texto plano + HTML, y las fotos adjuntas con el nombre de su toma. */
export function armarMensaje(config, registro, fotos) {
  const pesoFotos = fotos.reduce((total, foto) => total + foto.contenido.length, 0);
  const conAdjuntos = fotos.length > 0 && pesoFotos <= ADJUNTOS_MAXIMOS;
  const datos = datosParaMostrar(registro, fotos, conAdjuntos);
  const mezcla = `mezcla_${randomBytes(12).toString('hex')}`;
  const alternativa = `alt_${randomBytes(12).toString('hex')}`;
  const dominio = config.de.split('@')[1] || 'surcars.local';
  const responder = registro.contacto.email && direccionValida(registro.contacto.email) ? registro.contacto.email : '';

  const encabezados = [
    `From: ${encabezadoUtf8(config.nombre)} <${config.de}>`,
    `To: ${config.para.map((para) => `<${para}>`).join(', ')}`,
    ...(responder ? [`Reply-To: <${responder}>`] : []),
    `Subject: ${encabezadoUtf8(`Nueva consignación: ${datos.titulo}`)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomBytes(16).toString('hex')}@${dominio}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mezcla}"`,
  ];
  const partes = [
    `--${mezcla}`,
    `Content-Type: multipart/alternative; boundary="${alternativa}"`,
    '',
    `--${alternativa}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64EnLineas(textoPlano(registro, datos)),
    `--${alternativa}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64EnLineas(html(registro, datos)),
    `--${alternativa}--`,
  ];
  if (conAdjuntos) {
    fotos.forEach((foto, i) => {
      const nombre = path.basename(registro.fotos?.[i] ?? `foto-${i + 1}.${foto.extension}`).replace(/[^A-Za-z0-9._-]/g, '');
      partes.push(
        `--${mezcla}`,
        `Content-Type: ${TIPOS_IMAGEN[foto.extension] ?? 'application/octet-stream'}; name="${nombre}"`,
        `Content-Disposition: attachment; filename="${nombre}"`,
        'Content-Transfer-Encoding: base64',
        '',
        base64EnLineas(foto.contenido),
      );
    });
  }
  partes.push(`--${mezcla}--`);
  return `${encabezados.join('\r\n')}\r\n\r\n${partes.join('\r\n')}`;
}

/**
 * Avisa por email de un envío nuevo. Reintenta una vez si falla (por ejemplo, un corte de red).
 * Nunca frena la respuesta al formulario: se llama después de guardar el envío.
 */
export async function avisarNuevoLead(config, registro, fotos) {
  const mensaje = armarMensaje(config, registro, fotos);
  try {
    await enviarPorSmtp(config, mensaje);
  } catch (primerError) {
    // Un error de usuario o clave no se arregla reintentando.
    if (/\b535\b|\b534\b|\b530\b/.test(primerError.message)) throw primerError;
    await new Promise((resolver) => setTimeout(resolver, ESPERA_REINTENTO_MS));
    await enviarPorSmtp(config, mensaje);
  }
}
