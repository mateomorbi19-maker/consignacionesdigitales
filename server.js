/**
 * Surcars · Servidor local del formulario de consignación (campaña).
 *
 * Sin dependencias externas (Node 20 o superior):
 *   - sirve los archivos de ./public
 *   - recibe los envíos en POST /api/leads y los guarda en
 *     ./leads/<fecha>_<vehículo>_<id>/ (lead.json + fotos/)
 *
 * Uso:
 *   npm start      → http://localhost:3000 (solo esta compu)
 *   npm run red    → además, accesible desde el celular en la misma red Wi-Fi
 *   Otro puerto:   PORT=4000 npm start   (PowerShell: $env:PORT=4000; npm start)
 *   En un hosting: HOST=0.0.0.0 (y el PORT que asigne la plataforma)
 */

import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { avisarNuevoLead, enmascarar, leerConfiguracion as leerConfiguracionAviso } from './aviso-email.js';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const DIR_PUBLICO = path.join(RAIZ, 'public');
// Carpeta de los envíos: ./leads, salvo que se indique otra (LEADS_DIR), por ejemplo un volumen.
const DIR_LEADS = process.env.LEADS_DIR ? path.resolve(process.env.LEADS_DIR) : path.join(RAIZ, 'leads');
// Aviso por email de cada envío (se configura con AVISO_EMAIL y SMTP_*; ver aviso-email.js).
const AVISO = leerConfiguracionAviso();

const EN_RED = process.argv.includes('--red');
// En un hosting hay que escuchar en todas las interfaces: HOST=0.0.0.0. En local, solo esta compu.
const HOST = process.env.HOST || (EN_RED ? '0.0.0.0' : '127.0.0.1');
const PUERTO_INICIAL = Number.parseInt(process.env.PORT ?? '', 10) || 3000;

const LIMITES = {
  cuerpo: 40 * 1024 * 1024, // envío completo
  foto: 10 * 1024 * 1024, // por foto (el navegador ya las comprime a ~0,3–0,6 MB)
  fotos: 8,
};

// Tomas de las 8 casillas del paso 2: clave que manda el navegador (en el nombre del archivo) → nombre para el equipo.
const TOMAS = new Map([
  ['frente', 'Frente'],
  ['trasera', 'Trasera'],
  ['lateral-izquierdo', 'Lateral izquierdo'],
  ['lateral-derecho', 'Lateral derecho'],
  ['interior', 'Interior'],
  ['tablero', 'Tablero'],
  ['motor', 'Motor'],
  ['baul', 'Baúl'],
]);

const CLAVES_ORIGEN = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'gclid', 'gbraid', 'wbraid', 'fbclid', 'ttclid', 'msclkid', 'landing_url', 'referrer',
];

const TIPOS_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const CABECERAS_BASE = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

// envio_id → id del lead guardado. Si el navegador reintenta un envío que ya se guardó
// (p. ej., se cortó la conexión justo después), se responde con el mismo lead y no se duplica.
const enviosRecibidos = new Map();

/* ------------------------------------------------------------------ */
/* Respuestas                                                          */
/* ------------------------------------------------------------------ */

function responderJSON(res, estado, datos) {
  const cuerpo = JSON.stringify(datos);
  res.writeHead(estado, {
    ...CABECERAS_BASE,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(cuerpo),
    'Cache-Control': 'no-store',
  });
  res.end(cuerpo);
}

function responderTexto(res, estado, texto) {
  res.writeHead(estado, {
    ...CABECERAS_BASE,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(texto),
  });
  res.end(texto);
}

/* ------------------------------------------------------------------ */
/* Archivos estáticos                                                  */
/* ------------------------------------------------------------------ */

async function servirEstatico(req, res, rutaUrl) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...CABECERAS_BASE, Allow: 'GET, HEAD' });
    res.end();
    return;
  }

  let relativa;
  try {
    relativa = decodeURIComponent(rutaUrl);
  } catch {
    responderTexto(res, 400, 'Ruta inválida');
    return;
  }
  if (relativa.includes('\0')) {
    responderTexto(res, 400, 'Ruta inválida');
    return;
  }
  if (relativa.endsWith('/')) relativa += 'index.html';

  // Normalizar desde la raíz impide salir de /public con "../"
  const archivo = path.join(DIR_PUBLICO, path.normalize(`/${relativa}`));
  if (!archivo.startsWith(DIR_PUBLICO + path.sep)) {
    responderTexto(res, 404, 'No encontrado');
    return;
  }

  let info;
  try {
    info = await stat(archivo);
  } catch {
    responderTexto(res, 404, 'No encontrado');
    return;
  }
  if (!info.isFile()) {
    responderTexto(res, 404, 'No encontrado');
    return;
  }

  res.writeHead(200, {
    ...CABECERAS_BASE,
    'Content-Type': TIPOS_MIME[path.extname(archivo).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(archivo)
    .on('error', () => res.destroy())
    .pipe(res);
}

/* ------------------------------------------------------------------ */
/* Recepción de leads                                                  */
/* ------------------------------------------------------------------ */

function leerCuerpo(req, limite) {
  return new Promise((resolver, rechazar) => {
    const partes = [];
    let total = 0;
    let excedido = false;
    req.on('data', (parte) => {
      if (excedido) return;
      total += parte.length;
      if (total > limite) {
        excedido = true;
        partes.length = 0;
        return;
      }
      partes.push(parte);
    });
    req.on('end', () => {
      if (excedido) rechazar(Object.assign(new Error('Cuerpo demasiado grande'), { code: 'MUY_GRANDE' }));
      else resolver(Buffer.concat(partes));
    });
    req.on('error', rechazar);
  });
}

/** Texto de una línea: sin caracteres de control, espacios simples, recortado. */
function textoLimpio(valor, maximo) {
  if (typeof valor !== 'string') return '';
  return valor.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximo);
}

/** Texto multilínea: conserva los saltos de línea. */
function textoMultilinea(valor, maximo) {
  if (typeof valor !== 'string') return '';
  return valor
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maximo);
}

const SI_NO = new Set(['si', 'no']);
const TIPOS_REPARACION = new Set(['mecanica', 'estetica']);

/** Valida con las mismas reglas que el navegador (nunca confiar solo en el cliente). */
function validarLead(datos) {
  const errores = {};
  const anioActual = new Date().getFullYear();

  const marca = textoLimpio(datos.get('marca'), 60);
  const modelo = textoLimpio(datos.get('modelo'), 60);
  // La versión es opcional: si no la saben, llega vacía (o con version_desconocida = 'si').
  const versionDesconocida = textoLimpio(datos.get('version_desconocida'), 2) === 'si';
  const version = versionDesconocida ? '' : textoLimpio(datos.get('version'), 80);
  if (!marca) errores.marca = 'Falta la marca.';
  if (!modelo) errores.modelo = 'Falta el modelo.';

  const anio = Number(textoLimpio(datos.get('anio'), 4));
  if (!Number.isInteger(anio) || anio < 1950 || anio > anioActual + 1) errores.anio = 'El año no es válido.';

  const kmTexto = textoLimpio(datos.get('kilometraje'), 12).replace(/\D/g, '');
  const kilometraje = kmTexto ? Number(kmTexto) : Number.NaN;
  if (!Number.isInteger(kilometraje) || kilometraje < 0 || kilometraje > 999999) errores.kilometraje = 'El kilometraje no es válido.';

  const tuvoReparacion = textoLimpio(datos.get('tuvo_reparacion'), 2);
  if (!SI_NO.has(tuvoReparacion)) errores.tuvo_reparacion = 'Falta indicar si tuvo golpes o reparaciones.';
  let reparacion = null;
  if (tuvoReparacion === 'si') {
    const tipos = [...new Set(datos.getAll('tipo_reparacion').filter((tipo) => TIPOS_REPARACION.has(tipo)))];
    const detalle = textoMultilinea(datos.get('detalle_reparacion'), 1000);
    if (!tipos.length) errores.tipo_reparacion = 'Falta el tipo de reparación.';
    if (detalle.length < 3) errores.detalle_reparacion = 'Falta el detalle de la reparación.';
    reparacion = { tipos, detalle };
  }

  const unicaMano = textoLimpio(datos.get('unica_mano'), 2);
  if (!SI_NO.has(unicaMano)) errores.unica_mano = 'Falta indicar si es única mano.';

  // Contacto: alcanza con uno de los dos (teléfono o email), pero lo que venga tiene que ser válido.
  const telefono = textoLimpio(datos.get('telefono'), 25);
  const email = textoLimpio(datos.get('email'), 120);
  const digitosTelefono = telefono.replace(/\D/g, '');
  if (telefono && (!/^[+\d\s().-]+$/.test(telefono) || digitosTelefono.length < 8 || digitosTelefono.length > 15)) {
    errores.telefono = 'El teléfono no es válido.';
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errores.email = 'El email no es válido.';
  if (!telefono && !email) errores.contacto = 'Falta un dato de contacto.';

  const origen = {};
  for (const clave of CLAVES_ORIGEN) {
    const valor = textoLimpio(datos.get(clave), 500);
    if (valor) origen[clave] = valor;
  }

  return {
    errores,
    lead: {
      vehiculo: { marca, modelo, version: version || null, version_conocida: Boolean(version), anio },
      estado: {
        kilometraje,
        tuvo_golpe_o_reparacion: tuvoReparacion === 'si',
        reparacion,
        unica_mano: unicaMano === 'si',
      },
      contacto: {
        telefono: telefono || null,
        telefono_digitos: digitosTelefono || null,
        email: email || null,
      },
      origen,
    },
  };
}

/** Reconoce la imagen por su contenido (no por el nombre ni el tipo declarado). */
function detectarImagen(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp' && ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(buffer.toString('ascii', 8, 12))) return 'heic';
  return null;
}

async function leerFotos(datos) {
  const archivos = datos.getAll('fotos').filter((valor) => typeof valor !== 'string' && valor.size > 0);
  if (archivos.length > LIMITES.fotos) return { fotos: [], error: `Se pueden enviar hasta ${LIMITES.fotos} fotos.` };
  const fotos = [];
  const usadas = new Set();
  for (const archivo of archivos) {
    if (archivo.size > LIMITES.foto) return { fotos: [], error: 'Alguna foto supera el tamaño máximo permitido.' };
    const contenido = Buffer.from(await archivo.arrayBuffer());
    const extension = detectarImagen(contenido);
    if (!extension) return { fotos: [], error: 'Alguna de las fotos no es una imagen válida.' };
    // La toma viaja en el nombre del archivo ("frente.jpg"). Solo se usa como clave de la lista
    // blanca, nunca como ruta. Desconocida o repetida: la foto se guarda igual, sin toma.
    const clave = path.parse(archivo.name ?? '').name.toLowerCase();
    const toma = TOMAS.has(clave) && !usadas.has(clave) ? clave : null;
    if (toma) usadas.add(toma);
    fotos.push({ extension, contenido, toma });
  }
  return { fotos, error: null };
}

const dosDigitos = (n) => String(n).padStart(2, '0');
function selloLocal(fecha) {
  return `${fecha.getFullYear()}-${dosDigitos(fecha.getMonth() + 1)}-${dosDigitos(fecha.getDate())}_${dosDigitos(fecha.getHours())}-${dosDigitos(fecha.getMinutes())}-${dosDigitos(fecha.getSeconds())}`;
}
function slug(texto) {
  return (
    texto
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'vehiculo'
  );
}

async function guardarLead(lead, fotos) {
  const ahora = new Date();
  const { marca, modelo, anio } = lead.vehiculo;
  const id = `${selloLocal(ahora)}_${slug(`${marca} ${modelo} ${anio}`)}_${randomBytes(3).toString('hex')}`;
  const directorio = path.join(DIR_LEADS, id);
  await mkdir(directorio, { recursive: true });

  const rutasFotos = [];
  const tomasFotos = [];
  if (fotos.length) {
    await mkdir(path.join(directorio, 'fotos'));
    for (const [i, foto] of fotos.entries()) {
      // 01-frente.jpg, 02-trasera.jpg… (el número respeta el orden de las casillas); sin toma, como antes.
      const nombre = foto.toma ? `${dosDigitos(i + 1)}-${foto.toma}.${foto.extension}` : `foto-${dosDigitos(i + 1)}.${foto.extension}`;
      await writeFile(path.join(directorio, 'fotos', nombre), foto.contenido);
      rutasFotos.push(`fotos/${nombre}`);
      tomasFotos.push({ toma: foto.toma ? TOMAS.get(foto.toma) : null, archivo: `fotos/${nombre}` });
    }
  }

  const registro = { id, recibido: ahora.toISOString(), ...lead, fotos: rutasFotos, fotos_tomas: tomasFotos };
  await writeFile(path.join(directorio, 'lead.json'), `${JSON.stringify(registro, null, 2)}\n`, 'utf8');
  return registro;
}

async function recibirLead(req, res) {
  const tipo = req.headers['content-type'] ?? '';
  if (!/^multipart\/form-data/i.test(tipo)) {
    responderJSON(res, 415, { ok: false, error: 'El envío tiene que ser multipart/form-data.' });
    return;
  }
  if (Number(req.headers['content-length'] ?? 0) > LIMITES.cuerpo) {
    res.setHeader('Connection', 'close');
    responderJSON(res, 413, { ok: false, error: 'El envío es demasiado grande.' });
    return;
  }

  let cuerpo;
  try {
    cuerpo = await leerCuerpo(req, LIMITES.cuerpo);
  } catch (error) {
    if (error.code === 'MUY_GRANDE') {
      responderJSON(res, 413, { ok: false, error: 'El envío es demasiado grande.' });
      return;
    }
    throw error;
  }

  let datos;
  try {
    datos = await new Request('http://localhost/api/leads', {
      method: 'POST',
      headers: { 'content-type': tipo },
      body: cuerpo,
    }).formData();
  } catch {
    responderJSON(res, 400, { ok: false, error: 'No pudimos leer el formulario enviado.' });
    return;
  }

  const envioId = textoLimpio(datos.get('envio_id'), 64);
  const envioValido = /^[A-Za-z0-9-]{8,64}$/.test(envioId) ? envioId : '';
  if (envioValido && enviosRecibidos.has(envioValido)) {
    responderJSON(res, 200, { ok: true, id: enviosRecibidos.get(envioValido), repetido: true });
    return;
  }

  const { lead, errores } = validarLead(datos);
  const { fotos, error: errorFotos } = await leerFotos(datos);
  if (errorFotos) errores.fotos = errorFotos;
  if (Object.keys(errores).length) {
    responderJSON(res, 400, { ok: false, error: 'Revisá los datos: hay campos incompletos o inválidos.', errores });
    return;
  }

  lead.envio_id = envioValido || null;
  lead.tecnico = { user_agent: textoLimpio(req.headers['user-agent'] ?? '', 300) };
  const registro = await guardarLead(lead, fotos);
  if (envioValido) enviosRecibidos.set(envioValido, registro.id);
  const { marca, modelo, anio } = registro.vehiculo;
  const via = [registro.contacto.telefono && 'teléfono', registro.contacto.email && 'email'].filter(Boolean).join(' + ');
  console.log(`  ✔ Nuevo lead: ${marca} ${modelo} ${anio} · ${fotos.length} foto(s) · contacto: ${via} → leads/${registro.id}`);
  responderJSON(res, 201, { ok: true, id: registro.id });

  // El aviso sale después de responder: el vendedor no espera al mail, y si el mail falla el envío ya quedó guardado.
  if (AVISO) {
    avisarNuevoLead(AVISO, registro, fotos)
      .then(() => console.log(`  ✉ Aviso enviado por email: ${marca} ${modelo} ${anio}`))
      .catch((error) => console.error(`  ✖ No se pudo enviar el aviso por email (${registro.id}): ${error.message}`));
  }
}

/* ------------------------------------------------------------------ */
/* Servidor                                                            */
/* ------------------------------------------------------------------ */

const servidor = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname === '/api/leads') {
      if (req.method !== 'POST') {
        res.writeHead(405, { ...CABECERAS_BASE, Allow: 'POST' });
        res.end();
        return;
      }
      await recibirLead(req, res);
      return;
    }
    if (pathname.startsWith('/api/')) {
      responderJSON(res, 404, { ok: false, error: 'No encontrado.' });
      return;
    }
    await servirEstatico(req, res, pathname);
  } catch (error) {
    console.error('  ✖ Error inesperado:', error);
    if (!res.headersSent) responderJSON(res, 500, { ok: false, error: 'Error interno del servidor.' });
    else res.destroy();
  }
});

function direccionesDeRed() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((red) => red && red.family === 'IPv4' && !red.internal)
    .map((red) => red.address);
}

/** ¿Ya hay algo atendiendo en ese puerto? (En Windows, 127.0.0.1 y 0.0.0.0 pueden compartirlo sin error.) */
function puertoEnUso(puerto) {
  return new Promise((resolver) => {
    const conexion = net.connect({ port: puerto, host: '127.0.0.1' });
    conexion.setTimeout(500);
    conexion.once('connect', () => {
      conexion.destroy();
      resolver(true);
    });
    conexion.once('timeout', () => {
      conexion.destroy();
      resolver(false);
    });
    conexion.once('error', () => resolver(false));
  });
}

async function escuchar(puerto, intentosRestantes = 10) {
  const probarSiguiente = () => {
    if (intentosRestantes <= 0) {
      console.error(`  ✖ No encontré un puerto libre entre ${PUERTO_INICIAL} y ${puerto}.`);
      process.exit(1);
    }
    console.log(`  El puerto ${puerto} está ocupado, pruebo con el ${puerto + 1}…`);
    escuchar(puerto + 1, intentosRestantes - 1);
  };
  if (await puertoEnUso(puerto)) {
    probarSiguiente();
    return;
  }

  const alEscuchar = () => {
    servidor.off('error', alFallar);
    console.log('');
    console.log('  Surcars · Formulario de consignación');
    console.log(`  ➜ Local:  http://localhost:${puerto}`);
    if (EN_RED) {
      for (const ip of direccionesDeRed()) console.log(`  ➜ Red:    http://${ip}:${puerto}`);
      console.log('  (Usalo solo en redes de confianza: cualquiera en la misma red puede abrirlo.)');
    }
    console.log(`  Los envíos se guardan en: ${DIR_LEADS}`);
    console.log(
      AVISO
        ? `  ✉ Aviso por email: activo, a ${AVISO.para.map(enmascarar).join(', ')} (vía ${AVISO.host}:${AVISO.puerto})`
        : '  ✉ Aviso por email: desactivado (configurá AVISO_EMAIL y SMTP_*; ver el README)',
    );
    console.log('  (Ctrl+C para detener)');
    console.log('');
  };
  const alFallar = (error) => {
    servidor.off('listening', alEscuchar);
    if (error.code === 'EADDRINUSE') {
      probarSiguiente();
      return;
    }
    console.error('  ✖ No se pudo iniciar el servidor:', error.message);
    process.exit(1);
  };
  servidor.once('error', alFallar);
  servidor.once('listening', alEscuchar);
  servidor.listen(puerto, HOST);
}

escuchar(PUERTO_INICIAL);
