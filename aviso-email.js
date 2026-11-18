/**
 * Surcars · Aviso por email de cada envío nuevo de consignación.
 *
 * Sin dependencias. Dos formas de enviar, según las variables de entorno (nunca en el código:
 * el repositorio es público):
 *
 * 1) Por SMTP (por ejemplo, tu Gmail):
 *      AVISO_EMAIL   a quién avisar (uno o varios, separados por coma)
 *      SMTP_HOST     servidor SMTP (Gmail: smtp.gmail.com)
 *      SMTP_PORT     465 (TLS) o 587 (STARTTLS). Si tu hosting bloquea uno, probá el otro.
 *      SMTP_USER     cuenta que envía (Gmail: tu dirección completa)
 *      SMTP_PASS     clave de esa cuenta (Gmail: una "contraseña de aplicación", no la normal)
 *
 * 2) Por HTTPS con Resend (sirve aunque el hosting bloquee los puertos de correo):
 *      AVISO_EMAIL     a quién avisar (sin dominio propio verificado, solo el email de tu cuenta de Resend)
 *      RESEND_API_KEY  la clave de la API de Resend
 *      AVISO_DESDE     opcional: remitente (por defecto onboarding@resend.dev)
 *
 * Opcional en los dos: AVISO_REMITENTE, el nombre que aparece como remitente.
 *
 * El aviso sale después de guardar el envío: si el mail falla, el envío queda guardado igual
 * y el error queda anotado (con su explicación) en la consola del servidor.
 */

import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';

const TIEMPO_MAXIMO_MS = 15000; // sin respuesta del servidor de correo durante este tiempo, se corta
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
// Valor de una variable de entorno: sin espacios en los bordes ni comillas alrededor
// (algunos paneles guardan SMTP_PASS="..." con las comillas incluidas).
const unaLinea = (valor) =>
  String(valor ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .trim();

/** Lee la configuración del entorno. Devuelve null si el aviso no está configurado. */
export function leerConfiguracion(entorno = process.env) {
  const para = unaLinea(entorno.AVISO_EMAIL)
    .split(',')
    .map((valor) => unaLinea(valor))
    .filter(direccionValida);
  if (!para.length) return null;
  const nombre = unaLinea(entorno.AVISO_REMITENTE) || 'Surcars · Consignaciones';

  const claveResend = unaLinea(entorno.RESEND_API_KEY);
  if (claveResend) {
    const desde = unaLinea(entorno.AVISO_DESDE);
    return {
      modo: 'resend',
      para,
      nombre,
      claveResend,
      de: direccionValida(desde) ? desde : 'onboarding@resend.dev',
      urlResend: unaLinea(entorno.RESEND_API_URL) || 'https://api.resend.com/emails',
      host: 'api.resend.com',
      puerto: 443,
    };
  }

  const host = unaLinea(entorno.SMTP_HOST);
  if (!host) return null;
  const usuario = unaLinea(entorno.SMTP_USER);
  const desde = unaLinea(entorno.AVISO_DESDE);
  return {
    modo: 'smtp',
    para,
    nombre,
    host,
    puerto: Number.parseInt(entorno.SMTP_PORT ?? '', 10) || 465,
    usuario,
    clave: unaLinea(entorno.SMTP_PASS).replace(/\s+/g, ''), // las contraseñas de aplicación de Gmail vienen con espacios
    de: direccionValida(desde) ? desde : direccionValida(usuario) ? usuario : para[0],
  };
}

/** "m••••••19@gmail.com": para mostrar en la consola sin exponer la dirección completa. */
export function enmascarar(direccion) {
  const [usuario, dominio] = direccion.split('@');
  if (!dominio) return '•••';
  const visible = usuario.length <= 3 ? usuario.slice(0, 1) : `${usuario.slice(0, 1)}${'•'.repeat(Math.min(6, usuario.length - 3))}${usuario.slice(-2)}`;
  return `${visible}@${dominio}`;
}

/** Traduce un error técnico a qué pasó y qué hacer. */
export function explicarError(error, config) {
  const mensaje = String(error?.message ?? error);
  const codigo = error?.code ?? '';
  if (config.modo === 'resend') {
    if (/\b401\b|\b403\b/.test(mensaje)) return `Resend rechazó la clave: revisá RESEND_API_KEY. (${mensaje})`;
    if (/\b422\b/.test(mensaje) && /domain|verify|own email|testing emails/i.test(mensaje)) {
      return `Resend no deja mandar a esa dirección: sin un dominio propio verificado, solo podés mandarte a vos (el email de tu cuenta de Resend), desde onboarding@resend.dev. (${mensaje})`;
    }
    return `Resend no aceptó el mail. (${mensaje})`;
  }
  const otroPuerto = config.puerto === 465 ? 587 : 465;
  if (['ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET'].includes(codigo) || /no respondió a tiempo/.test(mensaje)) {
    return `No se pudo conectar con ${config.host}:${config.puerto}. Lo más probable es que el hosting bloquee ese puerto de correo: probá SMTP_PORT=${otroPuerto}, o mandá por HTTPS con RESEND_API_KEY (ver el README). (${codigo || mensaje})`;
  }
  if (codigo === 'ENOTFOUND' || codigo === 'EAI_AGAIN') return `No se encontró el servidor de correo "${config.host}": revisá SMTP_HOST. (${codigo})`;
  if (/\b535\b|\b534\b/.test(mensaje)) {
    const pistas = [];
    if (config.usuario && !config.usuario.includes('@')) pistas.push('SMTP_USER no es una dirección completa (le falta el @...)');
    if (/gmail|google/i.test(config.host) && config.clave && !/^[a-z]{16}$/i.test(config.clave)) {
      pistas.push('SMTP_PASS no tiene la forma de una contraseña de aplicación de Gmail (16 letras): parece tu clave normal');
    }
    const extra = pistas.length ? ` Revisá: ${pistas.join('; ')}.` : '';
    return `El servidor de correo rechazó el usuario o la clave. En Gmail, SMTP_USER es tu dirección completa y SMTP_PASS una contraseña de aplicación (no tu clave normal; necesita la verificación en dos pasos).${extra} (${mensaje})`;
  }
  if (/\b530\b/.test(mensaje)) return `El servidor de correo pide usuario y clave: completá SMTP_USER y SMTP_PASS. (${mensaje})`;
  if (/certificate|self[- ]signed|CERT_/i.test(mensaje + codigo)) return `Falló el certificado TLS de ${config.host}. (${codigo || mensaje})`;
  return mensaje;
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
    this.alCerrar = () => this.fallar(new Error('El servidor de correo cerró la conexión.'));
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
      throw new Error(`el servidor de correo respondió ${respuesta.codigo} a ${que}: ${respuesta.texto.replace(/\s+/g, ' ').slice(0, 200)}`);
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
    const tiempo = setTimeout(() => {
      const error = new Error('el servidor de correo no respondió a tiempo');
      error.code = 'ETIMEDOUT';
      socket.destroy(error);
    }, TIEMPO_MAXIMO_MS);
    socket.once(directo ? 'secureConnect' : 'connect', () => {
      clearTimeout(tiempo);
      socket.setTimeout(TIEMPO_MAXIMO_MS, () => socket.destroy(Object.assign(new Error('el servidor de correo no respondió a tiempo'), { code: 'ETIMEDOUT' })));
      resolver(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(tiempo);
      rechazar(error);
    });
  });
}

function pasarATls(socket, host) {
  return new Promise((resolver, rechazar) => {
    const seguro = tls.connect({ socket, servername: host }, () => resolver(seguro));
    seguro.setTimeout(TIEMPO_MAXIMO_MS, () => seguro.destroy(Object.assign(new Error('el servidor de correo no respondió a tiempo'), { code: 'ETIMEDOUT' })));
    seguro.once('error', rechazar);
  });
}

/**
 * Abre una sesión SMTP autenticada (con TLS) y llama a `trabajo(sesion, socket)`.
 * Sin `trabajo`, solo verifica que la conexión y la clave anden.
 */
async function conSesionSmtp(config, trabajo) {
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
        throw new Error('el servidor de correo no ofrece cifrado (STARTTLS): no se manda la clave sin cifrar');
      }
    }
    if (config.usuario && config.clave) {
      const credenciales = Buffer.from(`\u0000${config.usuario}\u0000${config.clave}`, 'utf8').toString('base64');
      await sesion.comando(`AUTH PLAIN ${credenciales}`, [235], 'el usuario y la clave');
    }
    if (trabajo) await trabajo(sesion, socket);
    await sesion.comando('QUIT', [221]).catch(() => {});
  } finally {
    socket.end();
  }
}

async function enviarPorSmtp(config, mensaje) {
  await conSesionSmtp(config, async (sesion, socket) => {
    await sesion.comando(`MAIL FROM:<${config.de}>`, [250]);
    for (const para of config.para) await sesion.comando(`RCPT TO:<${para}>`, [250, 251]);
    await sesion.comando('DATA', [354]);
    // Una línea que empieza con "." se duplica (así el servidor no la toma como fin del mensaje).
    socket.write(`${mensaje.replace(/^\./gm, '..')}\r\n.\r\n`);
    await sesion.esperar([250], 'el mensaje');
  });
}

/* ------------------------------------------------------------------ */
/* Envío por HTTPS (Resend)                                            */
/* ------------------------------------------------------------------ */

async function enviarPorResend(config, aviso) {
  const respuesta = await fetch(config.urlResend, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.claveResend}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${config.nombre} <${config.de}>`,
      to: config.para,
      subject: aviso.asunto,
      html: aviso.html,
      text: aviso.texto,
      ...(aviso.responder ? { reply_to: aviso.responder } : {}),
      ...(aviso.adjuntos.length
        ? { attachments: aviso.adjuntos.map((adjunto) => ({ filename: adjunto.nombre, content: adjunto.contenido.toString('base64') })) }
        : {}),
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => '');
    throw new Error(`Resend respondió ${respuesta.status}: ${cuerpo.replace(/\s+/g, ' ').slice(0, 300)}`);
  }
}

/* ------------------------------------------------------------------ */
/* Contenido del aviso                                                 */
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

/** Asunto, texto, HTML, "responder a" y adjuntos del aviso (los usan el SMTP y Resend). */
export function prepararAviso(registro, fotos) {
  const pesoFotos = fotos.reduce((total, foto) => total + foto.contenido.length, 0);
  const conAdjuntos = fotos.length > 0 && pesoFotos <= ADJUNTOS_MAXIMOS;
  const datos = datosParaMostrar(registro, fotos, conAdjuntos);
  const adjuntos = conAdjuntos
    ? fotos.map((foto, i) => ({
        nombre: path.basename(registro.fotos?.[i] ?? `foto-${i + 1}.${foto.extension}`).replace(/[^A-Za-z0-9._-]/g, ''),
        tipo: TIPOS_IMAGEN[foto.extension] ?? 'application/octet-stream',
        contenido: foto.contenido,
      }))
    : [];
  return {
    asunto: `Nueva consignación: ${datos.titulo}`,
    texto: textoPlano(registro, datos),
    html: html(registro, datos),
    responder: registro.contacto.email && direccionValida(registro.contacto.email) ? registro.contacto.email : '',
    adjuntos,
  };
}

/** Arma el mail completo (MIME) para SMTP: texto plano + HTML, y las fotos adjuntas. */
export function armarMensaje(config, registro, fotos) {
  const aviso = prepararAviso(registro, fotos);
  const mezcla = `mezcla_${randomBytes(12).toString('hex')}`;
  const alternativa = `alt_${randomBytes(12).toString('hex')}`;
  const dominio = config.de.split('@')[1] || 'surcars.local';
  const encabezados = [
    `From: ${encabezadoUtf8(config.nombre)} <${config.de}>`,
    `To: ${config.para.map((para) => `<${para}>`).join(', ')}`,
    ...(aviso.responder ? [`Reply-To: <${aviso.responder}>`] : []),
    `Subject: ${encabezadoUtf8(aviso.asunto)}`,
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
    base64EnLineas(aviso.texto),
    `--${alternativa}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64EnLineas(aviso.html),
    `--${alternativa}--`,
  ];
  for (const adjunto of aviso.adjuntos) {
    partes.push(
      `--${mezcla}`,
      `Content-Type: ${adjunto.tipo}; name="${adjunto.nombre}"`,
      `Content-Disposition: attachment; filename="${adjunto.nombre}"`,
      'Content-Transfer-Encoding: base64',
      '',
      base64EnLineas(adjunto.contenido),
    );
  }
  partes.push(`--${mezcla}--`);
  return `${encabezados.join('\r\n')}\r\n\r\n${partes.join('\r\n')}`;
}

/* ------------------------------------------------------------------ */
/* API del módulo                                                      */
/* ------------------------------------------------------------------ */

/**
 * Verifica al arrancar que el aviso pueda salir: con SMTP, que conecte y que el usuario y la
 * clave anden (sin mandar nada). Con Resend no hay verificación sin mandar: se confía en la clave.
 */
export async function verificarAviso(config) {
  if (config.modo === 'smtp') await conSesionSmtp(config);
}

/**
 * Avisa por email de un envío nuevo. Reintenta una vez si falla (por ejemplo, un corte de red).
 * Nunca frena la respuesta al formulario: se llama después de guardar el envío.
 */
export async function avisarNuevoLead(config, registro, fotos) {
  const enviar = config.modo === 'resend' ? () => enviarPorResend(config, prepararAviso(registro, fotos)) : () => enviarPorSmtp(config, armarMensaje(config, registro, fotos));
  try {
    await enviar();
  } catch (primerError) {
    // Un problema de clave o de configuración no se arregla reintentando.
    if (/\b535\b|\b534\b|\b530\b|\b401\b|\b403\b|\b422\b|ENOTFOUND/.test(`${primerError.message} ${primerError.code ?? ''}`)) throw primerError;
    await new Promise((resolver) => setTimeout(resolver, ESPERA_REINTENTO_MS));
    await enviar();
  }
}
