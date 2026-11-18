// E2E del formulario de consignación (3 pasos) con Edge headless.
// Uso: node e2e-flujo.mjs <carpetaCapturas> <carpetaLeads>
import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:3000';
const OUT = path.resolve(process.argv[2] || './shots-v3');
const LEADS = process.argv[3];
await fs.mkdir(OUT, { recursive: true });

const problemas = [];
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (cond, msg) => { log(`${cond ? '  OK ' : '  XX '} ${msg}`); if (!cond) problemas.push(msg); };
const MOVIL = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-first-run', '--disable-extensions', '--lang=es-AR'] });

async function nuevaPagina(viewport, etiqueta) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  page.on('console', (m) => { if (['error', 'warn', 'warning'].includes(m.type())) problemas.push(`[${etiqueta} console.${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => problemas.push(`[${etiqueta} pageerror] ${e.message}`));
  page.on('requestfailed', (r) => problemas.push(`[${etiqueta} requestfailed] ${r.url()} ${r.failure()?.errorText}`));
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:')) problemas.push(`[${etiqueta} externo] ${u}`); });
  return page;
}

async function generarArchivos() {
  const p = await browser.newPage();
  await p.setViewport({ width: 1500, height: 1000, deviceScaleFactor: 2 });
  const archivos = [];
  const fondos = [['#3a3f4b', '#9aa3b5'], ['#1d2b4a', '#5f7fbf'], ['#4a2b1d', '#bf8f5f'], ['#203a2a', '#6fbf8a']];
  for (const [i, [a, b]] of fondos.entries()) {
    await p.setContent(`<body style="margin:0;height:100vh;display:grid;place-items:center;background:linear-gradient(135deg,${a},${b});font:700 160px system-ui;color:#fff">FOTO ${i + 1}</body>`);
    const tipo = i === 3 ? 'png' : 'jpeg';
    const f = path.join(OUT, `prueba-${i + 1}.${tipo === 'png' ? 'png' : 'jpg'}`);
    await p.screenshot({ path: f, type: tipo, ...(tipo === 'jpeg' ? { quality: 92 } : {}) });
    archivos.push(f);
  }
  await p.close();
  const texto = path.join(OUT, 'documento.txt');
  await fs.writeFile(texto, 'no soy una imagen');
  return { fotos: archivos, texto };
}

function dimensionesJpeg(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marcador = buf[i + 1];
    const largo = buf.readUInt16BE(i + 2);
    if ([0xc0, 0xc1, 0xc2].includes(marcador)) return { alto: buf.readUInt16BE(i + 5), ancho: buf.readUInt16BE(i + 7) };
    i += 2 + largo;
  }
  return null;
}

async function ultimoLead() {
  const dirs = (await fs.readdir(LEADS)).sort();
  const dir = path.join(LEADS, dirs[dirs.length - 1]);
  return { dir, lead: JSON.parse(await fs.readFile(path.join(dir, 'lead.json'), 'utf8')) };
}
const visible = (page, sel) => page.$eval(sel, (e) => !e.hidden && e.offsetParent !== null).catch(() => false);
const paso = (page) => page.evaluate(() => document.body.dataset.paso);
const errores = (page, panel) => page.$$eval(`${panel} .error:not([hidden])`, (els) => els.map((e) => e.textContent));
async function reemplazar(page, sel, texto) {
  await page.click(sel);
  await page.$eval(sel, (e) => e.select());
  await page.keyboard.type(texto);
}

const { fotos, texto } = await generarArchivos();

/* ===================== Flujo 1: celular, completo ===================== */
log('\n== Flujo 1 (celular 390x844): completo con fotos, reparación y contacto');
{
  const page = await nuevaPagina(MOVIL, 'movil1');
  await page.goto(`${BASE}/?utm_source=facebook&utm_medium=paid&utm_campaign=consignacion-test&fbclid=TEST123`, { waitUntil: 'networkidle0' });
  await sleep(1100);
  await page.screenshot({ path: `${OUT}/m01-intro.png` });
  check((await page.$eval('#titulo-intro', (e) => e.textContent.replace(/\s+/g, ' ').trim())) === 'Venta 100% digital', 'Título "Venta 100% digital"');
  check(await page.$eval('.marca-logo', (e) => e.complete && e.naturalWidth > 100), 'Logo de Surcars cargado en el encabezado');
  const peso = await page.evaluate(() => Math.round(performance.getEntriesByType('resource').concat(performance.getEntriesByType('navigation')).reduce((t, r) => t + (r.transferSize || 0), 0) / 1024));
  log(`  peso inicial transferido: ${peso} KB`);
  const ancho = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  check(ancho[0] <= ancho[1], `Sin scroll horizontal en intro (${ancho[0]} <= ${ancho[1]})`);

  await page.click('#btn-empezar');
  await page.waitForSelector('#panel-vehiculo:not([hidden])');
  await sleep(600);
  check((await page.$eval('#panel-vehiculo .paso-numero', (e) => e.textContent)) === 'Paso 1 de 3', 'Paso 1 de 3');
  await page.click('#panel-vehiculo button[type=submit]');
  await sleep(500);
  check((await errores(page, '#panel-vehiculo')).length === 3, '3 errores al continuar vacío en el paso 1');

  await page.type('#marca', 'toy', { delay: 30 });
  await sleep(300);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  check((await page.$eval('#marca', (e) => e.value)) === 'Toyota', 'Marca con teclado = Toyota');
  await page.click('#modelo');
  await page.type('#modelo', 'coro', { delay: 30 });
  await sleep(300);
  await (await page.$('#lista-modelo [role=option]')).click();
  check((await page.$eval('#modelo', (e) => e.value)) === 'Corolla', 'Modelo tocando la opción = Corolla');
  await page.waitForFunction(() => !document.querySelector('#toggle-version').hidden, { timeout: 10000 });
  await page.click('#version');
  await sleep(300);
  const versiones = await page.$$eval('#lista-version [role=option]', (els) => els.map((e) => e.textContent));
  check(versiones.length > 5, `Versiones del Corolla: ${versiones.slice(0, 5).join(' | ')}…`);
  await page.click('#lista-version [role=option]:nth-child(2)');
  const versionElegida = await page.$eval('#version', (e) => e.value);
  await reemplazar(page, '#modelo', 'Hilux');
  await page.keyboard.press('Tab');
  await sleep(150);
  check((await page.$eval('#version', (e) => e.value)) === '', 'Cambiar de modelo limpia la versión que no corresponde');
  await reemplazar(page, '#modelo', 'Corolla');
  await page.keyboard.press('Tab');
  await page.click('#version');
  await sleep(250);
  await page.click('#lista-version [role=option]:nth-child(2)');
  await page.select('#anio', '2019');
  await page.click('#panel-vehiculo button[type=submit]');
  await page.waitForSelector('#panel-estado:not([hidden])');
  await sleep(600);
  check((await page.$eval('#panel-estado .paso-numero', (e) => e.textContent)) === 'Paso 2 de 3', 'Paso 2 de 3');
  check((await page.$eval('#btn-continuar-estado', (e) => e.textContent.trim())) === 'Continuar', 'El paso 2 termina con "Continuar"');

  await page.type('#kilometraje', '85000');
  check((await page.$eval('#kilometraje', (e) => e.value)) === '85.000', 'Kilometraje formateado 85.000');
  await page.click('input[name=tuvo_reparacion][value=si]');
  await sleep(450);
  check(await page.$eval('#reparacion', (e) => e.classList.contains('abierto')), 'Con "Sí" se despliega el detalle');
  await page.click('input[name=unica_mano][value=no]');
  await page.click('#btn-continuar-estado');
  await sleep(450);
  check((await errores(page, '#panel-estado')).length === 2, 'Detalle de reparación incompleto: 2 errores');
  await page.click('input[name=tipo_reparacion][value=estetica]');
  await page.type('#detalle-reparacion', 'Choque leve en el paragolpes trasero, se cambió y se pintó en 2023.');

  const input = await page.$('#input-fotos');
  await input.uploadFile(...fotos, texto);
  await page.waitForFunction(() => !document.querySelector('.foto--cargando'), { timeout: 30000 });
  check((await page.$$eval('#fotos-grid .foto', (els) => els.length)) === 4, 'Se agregan 4 fotos y se rechaza el .txt');
  await page.click('#fotos-grid .foto:nth-child(2) .foto-quitar');
  await input.uploadFile(...fotos, ...fotos, ...fotos);
  await page.waitForFunction(() => !document.querySelector('.foto--cargando'), { timeout: 60000 });
  check((await page.$$eval('#fotos-grid .foto', (els) => els.length)) === 8, 'Tope de 8 fotos');
  await page.screenshot({ path: `${OUT}/m02-paso2.png`, fullPage: true });

  await page.click('#btn-continuar-estado');
  await page.waitForSelector('#panel-contacto:not([hidden])');
  await sleep(600);
  check((await page.evaluate(() => location.hash)) === '#contacto', 'Hash #contacto en el paso 3');
  check((await page.$eval('#panel-contacto .paso-numero', (e) => e.textContent)) === 'Paso 3 de 3', 'Paso 3 de 3');
  const textoPaso3 = await page.$eval('#panel-contacto', (e) => e.innerText.toLowerCase());
  check(!/al menos|uno de los dos|alguno de|opcional/.test(textoPaso3), 'El paso 3 no dice que alcanza con un solo dato');
  await page.screenshot({ path: `${OUT}/m03-paso3.png` });

  await page.click('#btn-enviar');
  await sleep(450);
  const erroresVacio = await errores(page, '#panel-contacto');
  check(JSON.stringify(erroresVacio) === JSON.stringify(['Ingresá tu teléfono.', 'Ingresá tu email.']), `Sin datos de contacto no se puede avanzar: ${JSON.stringify(erroresVacio)}`);
  await page.screenshot({ path: `${OUT}/m04-paso3-errores.png` });
  await page.type('#telefono', '11 2345 6789');
  check((await errores(page, '#panel-contacto')).length === 0, 'Al escribir el teléfono se limpian los dos errores');
  await page.type('#email', 'juan@');
  await page.click('#btn-enviar');
  await sleep(400);
  check(JSON.stringify(await errores(page, '#panel-contacto')) === JSON.stringify(['Revisá el email.']), 'Email mal escrito: "Revisá el email."');
  await page.type('#email', 'mail.com');
  check((await errores(page, '#panel-contacto')).length === 0, 'Al corregir el email se limpia el error');

  await page.evaluate(() => history.back());
  await page.waitForSelector('#panel-estado:not([hidden])');
  check((await page.$$eval('#fotos-grid .foto', (els) => els.length)) === 8, 'Atrás desde el paso 3: paso 2 con las 8 fotos');
  await page.evaluate(() => history.forward());
  await page.waitForSelector('#panel-contacto:not([hidden])');
  check((await page.$eval('#telefono', (e) => e.value)) === '11 2345 6789', 'Adelante: el paso 3 conserva el teléfono');

  await page.click('#btn-enviar');
  await page.waitForSelector('#panel-listo:not([hidden])', { timeout: 30000 });
  await sleep(800);
  const resumen = await page.$$eval('#resumen div', (els) => els.map((e) => `${e.children[0].textContent}: ${e.children[1].textContent}`));
  check(resumen.includes('Contacto: 11 2345 6789 · juan@mail.com'), `Resumen con contacto: ${resumen[resumen.length - 1]}`);
  await page.screenshot({ path: `${OUT}/m05-listo.png`, fullPage: true });
  const capa = await page.evaluate(() => (window.dataLayer || []).map((e) => e.event));
  check(JSON.stringify(capa) === JSON.stringify(['consignacion_inicio', 'consignacion_vehiculo', 'consignacion_estado', 'consignacion_lead']), `Eventos: ${JSON.stringify(capa)}`);

  const { dir, lead } = await ultimoLead();
  check(lead.vehiculo.marca === 'Toyota' && lead.vehiculo.version === versionElegida && lead.vehiculo.anio === 2019, `lead.json vehículo (${lead.vehiculo.version})`);
  check(lead.contacto.telefono === '11 2345 6789' && lead.contacto.telefono_digitos === '1123456789' && lead.contacto.email === 'juan@mail.com', `lead.json contacto ${JSON.stringify(lead.contacto)}`);
  check(lead.origen.utm_source === 'facebook' && lead.origen.fbclid === 'TEST123', 'lead.json con UTM y fbclid');
  // Cada foto llega con el nombre de su toma, en el orden de las casillas (01-frente.jpg … 08-baul.jpg).
  const TOMAS = ['Frente', 'Trasera', 'Lateral izquierdo', 'Lateral derecho', 'Interior', 'Tablero', 'Motor', 'Baúl'];
  const tomas = (lead.fotos_tomas || []).map((f) => f.toma);
  check(
    lead.fotos.length === 8 && JSON.stringify(tomas) === JSON.stringify(TOMAS) && lead.fotos[0] === 'fotos/01-frente.jpg',
    `lead.json con 8 fotos, cada una con su toma (${tomas.join(', ')})`,
  );
  const dim = dimensionesJpeg(await fs.readFile(path.join(dir, lead.fotos[0])));
  check(dim && Math.max(dim.ancho, dim.alto) <= 1600, `Fotos comprimidas (${dim?.ancho}x${dim?.alto})`);

  await page.evaluate(() => history.back());
  await sleep(500);
  check((await paso(page)) === 'intro' && (await page.$eval('#telefono', (e) => e.value)) === '', 'Atrás después de enviar: vuelve al inicio con todo limpio');
  await page.close();
}

/* ===================== Flujo 2: celular, sin fotos, solo email, recarga ===================== */
log('\n== Flujo 2 (celular): texto libre, "No sé la versión", sin fotos, solo email');
{
  const page = await nuevaPagina(MOVIL, 'movil2');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await page.click('#btn-empezar');
  await page.waitForSelector('#panel-vehiculo:not([hidden])');
  await page.type('#marca', 'Tata');
  await page.keyboard.press('Enter');
  check((await page.evaluate(() => document.activeElement?.id)) === 'modelo', 'Enter en Marca pasa a Modelo');
  await page.type('#modelo', 'Indica');
  await page.keyboard.press('Enter');
  await page.click('#version-desconocida');
  check(await page.$eval('#version', (e) => e.disabled), '"No sé la versión" deshabilita el campo');
  await page.select('#anio', '2010');
  await page.click('#panel-vehiculo button[type=submit]');
  await page.waitForSelector('#panel-estado:not([hidden])');
  await page.type('#kilometraje', '120000');
  await page.click('input[name=tuvo_reparacion][value=no]');
  await page.click('input[name=unica_mano][value=si]');
  await page.click('#btn-continuar-estado');
  await sleep(450);
  check(await visible(page, '#nudge-fotos'), 'Sin fotos: aparece el aviso');
  check((await page.$eval('#btn-continuar-estado', (e) => e.textContent.trim())) === 'Continuar sin fotos', 'El botón pasa a "Continuar sin fotos"');
  await page.screenshot({ path: `${OUT}/m06-aviso-sin-fotos.png` });
  await page.click('#btn-continuar-estado');
  await page.waitForSelector('#panel-contacto:not([hidden])');

  await page.type('#telefono', '11 2345 6789');
  await page.keyboard.press('Enter');
  check((await page.evaluate(() => document.activeElement?.id)) === 'email' && (await paso(page)) === 'contacto', 'Enter en el teléfono pasa al email (no envía)');
  await page.$eval('#telefono', (e) => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.type('#email', 'vendedor@example.com');
  await sleep(450); // borrador
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(400);
  check((await paso(page)) === 'contacto' && (await page.$eval('#email', (e) => e.value)) === 'vendedor@example.com', 'Recargar en el paso 3 lo retoma con el email');
  await page.focus('#email');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#panel-listo:not([hidden])', { timeout: 15000 });
  const { lead } = await ultimoLead();
  check(lead.contacto.email === 'vendedor@example.com' && lead.contacto.telefono === null, 'Solo email alcanza para enviar');
  check(lead.vehiculo.version === null && lead.vehiculo.version_conocida === false && lead.fotos.length === 0, 'Lead sin versión y sin fotos');
  await page.close();
}

/* ===================== Flujo 3: celular chico ===================== */
log('\n== Flujo 3 (celular chico 360x740)');
{
  const page = await nuevaPagina({ width: 360, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 'chico');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await sleep(1000);
  await page.screenshot({ path: `${OUT}/s01-intro-360.png` });
  const boton = await page.$eval('#btn-empezar', (e) => { const r = e.getBoundingClientRect(); return { abajo: Math.round(r.bottom), alto: innerHeight, lineas: Math.round(r.height / parseFloat(getComputedStyle(e).lineHeight || 20)) }; });
  check(boton.abajo <= boton.alto, `Botón grande visible sin scroll en 360x740 (${boton.abajo}px)`);
  await page.close();
}

/* ===================== Flujo 4: escritorio ===================== */
log('\n== Flujo 4 (escritorio 1440x900)');
{
  const page = await nuevaPagina({ width: 1440, height: 900, deviceScaleFactor: 1 }, 'desktop');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await sleep(1100);
  await page.screenshot({ path: `${OUT}/d01-intro.png` });
  await page.click('#btn-empezar');
  await page.waitForSelector('#panel-vehiculo:not([hidden])');
  await page.type('#marca', 'Chevrolet');
  await page.keyboard.press('Tab');
  await page.type('#modelo', 'Onix');
  await page.keyboard.press('Tab');
  await page.select('#anio', '2017');
  await page.click('#panel-vehiculo button[type=submit]');
  await page.waitForSelector('#panel-estado:not([hidden])');
  await page.type('#kilometraje', '60000');
  await page.click('input[name=tuvo_reparacion][value=no]');
  await page.click('input[name=unica_mano][value=si]');
  await page.click('#btn-continuar-estado');
  await sleep(300);
  await page.click('#btn-continuar-estado');
  await page.waitForSelector('#panel-contacto:not([hidden])');
  await sleep(600);
  await page.screenshot({ path: `${OUT}/d02-paso3.png` });
  await page.close();
}

/* ===================== Flujo 5: movimiento reducido ===================== */
log('\n== Flujo 5 (prefers-reduced-motion)');
{
  const page = await nuevaPagina(MOVIL, 'reducido');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await page.click('#btn-empezar');
  check((await paso(page)) === 'vehiculo', 'Con movimiento reducido el botón avanza al instante');
  await page.close();
}

await browser.close();
log('\n== Problemas / mensajes de consola');
if (!problemas.length) log('  (ninguno)');
for (const p of problemas) log(`  - ${p}`);
process.exitCode = problemas.length ? 1 : 0;
