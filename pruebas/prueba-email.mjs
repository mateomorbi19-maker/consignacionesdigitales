// Prueba del aviso por email. Un servidor SMTP falso (en esta compu) recibe el mail de un envío.
// No manda mails reales ni toca ../leads: usa una carpeta temporal. Uso: node prueba-email.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SERVIDOR = path.join(AQUI, '..', 'server.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0;
let bien = 0;
const problemas = [];
const check = (cond, msg) => {
  total += 1;
  if (cond) bien += 1;
  else problemas.push(msg);
  console.log(`${cond ? '  OK ' : '  XX '} ${msg}`);
};

/* ---------- Servidor SMTP falso ---------- */
function smtpFalso({ rechazarClave = false } = {}) {
  const recibidos = [];
  let alRecibir = null;
  const servidor = net.createServer((socket) => {
    socket.setEncoding('utf8');
    const sesion = { comandos: [], para: [] };
    let pendiente = '';
    let enDatos = false;
    socket.write('220 smtp-falso listo\r\n');
    socket.on('data', (trozo) => {
      pendiente += trozo;
      for (;;) {
        if (enDatos) {
          const fin = pendiente.indexOf('\r\n.\r\n');
          if (fin < 0) return;
          sesion.datos = pendiente.slice(0, fin);
          pendiente = pendiente.slice(fin + 5);
          enDatos = false;
          recibidos.push(sesion);
          alRecibir?.(sesion);
          socket.write('250 2.0.0 Recibido\r\n');
          continue;
        }
        const fin = pendiente.indexOf('\r\n');
        if (fin < 0) return;
        const linea = pendiente.slice(0, fin);
        pendiente = pendiente.slice(fin + 2);
        sesion.comandos.push(linea);
        const comando = linea.split(' ')[0].toUpperCase();
        if (comando === 'EHLO') socket.write('250-smtp-falso\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n');
        else if (comando === 'AUTH') {
          sesion.auth = linea;
          socket.write(rechazarClave ? '535 5.7.8 Username and Password not accepted\r\n' : '235 2.7.0 Autenticado\r\n');
        } else if (comando === 'MAIL') {
          sesion.de = linea;
          socket.write('250 2.1.0 OK\r\n');
        } else if (comando === 'RCPT') {
          sesion.para.push(linea);
          socket.write('250 2.1.5 OK\r\n');
        } else if (comando === 'DATA') {
          enDatos = true;
          socket.write('354 Mandá el mensaje\r\n');
        } else if (comando === 'QUIT') {
          socket.write('221 2.0.0 Chau\r\n');
          socket.end();
        } else socket.write('502 5.5.2 No implementado\r\n');
      }
    });
  });
  return new Promise((listo) =>
    servidor.listen(0, '127.0.0.1', () =>
      listo({
        servidor,
        puerto: servidor.address().port,
        recibidos,
        esperarMail: (ms) =>
          new Promise((resolver, rechazar) => {
            if (recibidos.length) return resolver(recibidos[0]);
            const t = setTimeout(() => rechazar(new Error('no llegó ningún mail')), ms);
            alRecibir = (s) => {
              clearTimeout(t);
              resolver(s);
            };
          }),
      }),
    ),
  );
}

/* ---------- Landing con una carpeta de envíos temporal ---------- */
async function levantarLanding(entorno) {
  const leads = await fs.mkdtemp(path.join(os.tmpdir(), 'surcars-prueba-email-'));
  const limpio = { ...process.env };
  for (const clave of ['AVISO_EMAIL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'AVISO_REMITENTE', 'AVISO_DESDE', 'RESEND_API_KEY', 'RESEND_API_URL']) {
    delete limpio[clave];
  }
  const hijo = spawn(process.execPath, [SERVIDOR], {
    env: { ...limpio, PORT: '3290', HOST: '127.0.0.1', LEADS_DIR: leads, ...entorno },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let salida = '';
  hijo.stdout.on('data', (d) => (salida += d));
  hijo.stderr.on('data', (d) => (salida += d));
  const puerto = await new Promise((resolver, rechazar) => {
    const t = setTimeout(() => rechazar(new Error(`el servidor no arrancó:\n${salida}`)), 10000);
    const mirar = () => {
      // Se espera al final del arranque (la última línea es la de Ctrl+C).
      const m = salida.match(/http:\/\/localhost:(\d+)/);
      if (m && /Ctrl\+C/.test(salida)) {
        clearTimeout(t);
        resolver(Number(m[1]));
      }
    };
    hijo.stdout.on('data', mirar);
  });
  return { hijo, puerto, leads, salida: () => salida };
}

/** Espera (hasta `ms`) a que la consola del servidor muestre algo. */
async function esperarSalida(landing, patron, ms = 8000) {
  for (let t = 0; t < ms && !patron.test(landing.salida()); t += 100) await sleep(100);
  return patron.test(landing.salida());
}

const jpeg = (relleno) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, relleno)]);
const FOTO_1 = jpeg(1);
const FOTO_2 = jpeg(2);

function datosDeEnvio(id) {
  const datos = new FormData();
  const campos = {
    envio_id: `prueba-email-${id}`,
    marca: 'Toyota',
    modelo: 'Corolla',
    version: '1.8 XEI',
    anio: '2019',
    kilometraje: '85000',
    tuvo_reparacion: 'si',
    detalle_reparacion: 'Choque leve <b>trasero</b>; se pintó.',
    unica_mano: 'no',
    telefono: '11 2345 6789',
    email: 'juan@mail.com',
    utm_source: 'facebook',
    utm_medium: 'paid',
    utm_campaign: 'consignacion',
  };
  for (const [clave, valor] of Object.entries(campos)) datos.append(clave, valor);
  datos.append('tipo_reparacion', 'estetica');
  datos.append('fotos', new Blob([FOTO_1], { type: 'image/jpeg' }), 'frente.jpg');
  datos.append('fotos', new Blob([FOTO_2], { type: 'image/jpeg' }), 'trasera.jpg');
  return datos;
}

/* ---------- Lectura del mail recibido ---------- */
function leerMail(crudo) {
  const corte = crudo.indexOf('\r\n\r\n');
  const encabezados = crudo.slice(0, corte).replace(/\r\n[ \t]+/g, ' ');
  const encabezado = (nombre) => encabezados.match(new RegExp(`^${nombre}: (.*)$`, 'im'))?.[1] ?? '';
  const decodificar = (valor) =>
    valor.replace(/=\?UTF-8\?B\?([^?]+)\?=\s*/gi, (_, b64) => Buffer.from(b64, 'base64').toString('utf8')).trim();
  const partes = crudo.slice(corte + 4).split(/--(?:mezcla|alt)_[0-9a-f]+(?:--)?/);
  const parte = (tipo) => partes.find((p) => p.includes(`Content-Type: ${tipo}`));
  const cuerpo = (p) => (p ? Buffer.from(p.split('\r\n\r\n').slice(1).join('').replace(/\s+/g, ''), 'base64') : Buffer.alloc(0));
  const adjuntos = partes
    .filter((p) => /Content-Disposition: attachment/.test(p))
    .map((p) => ({ nombre: p.match(/filename="([^"]+)"/)?.[1], contenido: cuerpo(p) }));
  return {
    asunto: decodificar(encabezado('Subject')),
    para: encabezado('To'),
    responder: encabezado('Reply-To'),
    de: decodificar(encabezado('From')),
    html: cuerpo(parte('text/html')).toString('utf8'),
    texto: cuerpo(parte('text/plain')).toString('utf8'),
    adjuntos,
  };
}

/* ========== 1. Con el aviso configurado ========== */
console.log('\n== Aviso por email configurado');
{
  const smtp = await smtpFalso();
  const landing = await levantarLanding({
    AVISO_EMAIL: 'dueno@example.com',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(smtp.puerto),
    SMTP_USER: 'prueba@example.com',
    SMTP_PASS: 'abcd efgh ijkl mnop',
  });
  check(/Aviso por email: activo/.test(landing.salida()) && !/dueno@example\.com/.test(landing.salida()), 'Al arrancar dice que el aviso está activo, sin mostrar la dirección completa');
  check(await esperarSalida(landing, /Conexión con el correo: OK/), 'Al arrancar prueba la conexión y la clave, y lo confirma en los logs');
  const respuesta = await fetch(`http://127.0.0.1:${landing.puerto}/api/leads`, { method: 'POST', body: datosDeEnvio(Date.now()) });
  check(respuesta.status === 201, `El envío se guarda y responde 201 (${respuesta.status})`);
  const sesion = await smtp.esperarMail(10000).catch(() => null);
  check(Boolean(sesion), 'El mail llega al servidor SMTP');
  if (sesion) {
    const credenciales = Buffer.from(sesion.auth.split(' ')[2] ?? '', 'base64').toString('utf8');
    check(credenciales === '\u0000prueba@example.com\u0000abcdefghijklmnop', 'Se autentica con el usuario y la clave (sin los espacios de la contraseña de aplicación)');
    check(sesion.de === 'MAIL FROM:<prueba@example.com>' && sesion.para.join() === 'RCPT TO:<dueno@example.com>', 'Lo manda la cuenta configurada y le llega a AVISO_EMAIL');
    const mail = leerMail(sesion.datos);
    check(mail.asunto === 'Nueva consignación: Toyota Corolla 2019', `Asunto: "${mail.asunto}"`);
    check(mail.responder === '<juan@mail.com>', `"Responder" va al vendedor (${mail.responder})`);
    check(
      ['85.000 km', 'Sí (estética)', '1.8 XEI', 'Frente, Trasera', 'Llamar al 11 2345 6789', 'facebook · paid · consignacion'].every((t) => mail.html.includes(t)),
      'El HTML trae el resumen: kilometraje, reparación, versión, tomas, botón de llamar y origen',
    );
    check(mail.html.includes('&lt;b&gt;trasero&lt;/b&gt;') && !mail.html.includes('<b>trasero'), 'Lo que escribe el vendedor se muestra como texto (no se interpreta como HTML)');
    check(mail.texto.includes('Kilometraje: 85.000 km'), 'También va en texto plano');
    check(
      mail.adjuntos.length === 2 &&
        mail.adjuntos[0].nombre === '01-frente.jpg' &&
        mail.adjuntos[1].nombre === '02-trasera.jpg' &&
        mail.adjuntos[0].contenido.equals(FOTO_1) &&
        mail.adjuntos[1].contenido.equals(FOTO_2),
      `Las fotos van adjuntas con el nombre de su toma (${mail.adjuntos.map((a) => a.nombre).join(', ')})`,
    );
  }
  const dirs = await fs.readdir(landing.leads);
  check(dirs.length === 1, 'El envío queda guardado igual');
  landing.hijo.kill();
  smtp.servidor.close();
  await fs.rm(landing.leads, { recursive: true, force: true });
}

/* ========== 2. Con la clave rechazada: el formulario no se frena ========== */
console.log('\n== Clave rechazada por el servidor de correo');
{
  const smtp = await smtpFalso({ rechazarClave: true });
  const landing = await levantarLanding({
    AVISO_EMAIL: 'dueno@example.com',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(smtp.puerto),
    SMTP_USER: 'prueba@example.com',
    SMTP_PASS: 'clave-mala',
  });
  check(
    await esperarSalida(landing, /El aviso por email no va a salir: El servidor de correo rechazó el usuario o la clave.*contraseña de aplicación/),
    'Al arrancar avisa que la clave no anda y explica qué revisar',
  );
  const respuesta = await fetch(`http://127.0.0.1:${landing.puerto}/api/leads`, { method: 'POST', body: datosDeEnvio(Date.now() + 1) });
  check(respuesta.status === 201, `El vendedor ve su envío confirmado igual (${respuesta.status})`);
  check(await esperarSalida(landing, /No se pudo enviar el aviso por email .*rechazó el usuario o la clave.*535/), 'El error del mail queda anotado en la consola, explicado');
  check((await fs.readdir(landing.leads)).length === 1, 'Y el envío queda guardado');
  landing.hijo.kill();
  smtp.servidor.close();
  await fs.rm(landing.leads, { recursive: true, force: true });
}

/* ========== 3. Puerto de correo bloqueado (nadie atiende) ========== */
console.log('\n== Puerto de correo bloqueado');
{
  const libre = await new Promise((resolver) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolver(port));
    });
  });
  const landing = await levantarLanding({
    AVISO_EMAIL: 'dueno@example.com',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(libre),
    SMTP_USER: 'prueba@example.com',
    SMTP_PASS: 'clave',
  });
  check(
    await esperarSalida(landing, /El aviso por email no va a salir: No se pudo conectar con 127\.0\.0\.1:\d+\. .*bloquee ese puerto.*SMTP_PORT=465.*RESEND_API_KEY/),
    'Si el hosting bloquea el puerto, los logs lo dicen y sugieren el otro puerto o Resend',
  );
  landing.hijo.kill();
  await fs.rm(landing.leads, { recursive: true, force: true });
}

/* ========== 4. Por HTTPS con Resend (una API falsa en esta compu) ========== */
console.log('\n== Aviso por Resend');
{
  let pedido = null;
  const api = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (d) => (cuerpo += d));
    req.on('end', () => {
      pedido = { metodo: req.method, autorizacion: req.headers.authorization, json: JSON.parse(cuerpo || '{}') };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"id":"prueba"}');
    });
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  const landing = await levantarLanding({
    AVISO_EMAIL: 'dueno@example.com',
    RESEND_API_KEY: 're_prueba123',
    RESEND_API_URL: `http://127.0.0.1:${api.address().port}/emails`,
  });
  check(/Aviso por email: activo, a .* \(vía Resend\)/.test(landing.salida()), 'Al arrancar dice que avisa por Resend');
  const respuesta = await fetch(`http://127.0.0.1:${landing.puerto}/api/leads`, { method: 'POST', body: datosDeEnvio(Date.now() + 3) });
  check(respuesta.status === 201, `El envío responde 201 (${respuesta.status})`);
  for (let t = 0; t < 8000 && !pedido; t += 100) await sleep(100);
  const j = pedido?.json ?? {};
  check(pedido?.metodo === 'POST' && pedido?.autorizacion === 'Bearer re_prueba123', 'Llama a la API con la clave');
  check(
    JSON.stringify(j.to) === '["dueno@example.com"]' &&
      j.from === 'Surcars · Consignaciones <onboarding@resend.dev>' &&
      j.subject === 'Nueva consignación: Toyota Corolla 2019' &&
      j.reply_to === 'juan@mail.com',
    `Destinatario, remitente, asunto y "responder" correctos (${j.subject})`,
  );
  check(
    (j.attachments ?? []).length === 2 &&
      j.attachments[0].filename === '01-frente.jpg' &&
      Buffer.from(j.attachments[0].content, 'base64').equals(FOTO_1) &&
      String(j.html).includes('85.000 km'),
    'Lleva el resumen y las fotos adjuntas',
  );
  check(await esperarSalida(landing, /Aviso enviado por email/), 'Y lo confirma en los logs');
  landing.hijo.kill();
  api.close();
  await fs.rm(landing.leads, { recursive: true, force: true });
}

/* ========== 5. Sin configurar ========== */
console.log('\n== Sin configurar el aviso');
{
  const landing = await levantarLanding({});
  check(/Aviso por email: desactivado/.test(landing.salida()), 'Al arrancar avisa que el aviso por email está desactivado');
  const respuesta = await fetch(`http://127.0.0.1:${landing.puerto}/api/leads`, { method: 'POST', body: datosDeEnvio(Date.now() + 2) });
  check(respuesta.status === 201, `El formulario funciona igual (${respuesta.status})`);
  landing.hijo.kill();
  await fs.rm(landing.leads, { recursive: true, force: true });
}

console.log(`\n${bien}/${total} checks`);
if (problemas.length) {
  console.log('\nProblemas:');
  for (const p of problemas) console.log(' -', p);
  process.exitCode = 1;
}
