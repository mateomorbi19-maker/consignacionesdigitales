// E2E del catálogo de marcas con logos y de las fotos por toma, con Edge headless.
// Uso: node e2e-catalogo.mjs <carpetaCapturas> <carpetaLeads>
import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:3000';
const OUT = path.resolve(process.argv[2] || './capturas/catalogo');
const LEADS = process.argv[3];
await fs.mkdir(OUT, { recursive: true });

const problemas = [];
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0;
let bien = 0;
const check = (cond, msg) => {
  total += 1;
  if (cond) bien += 1;
  log(`${cond ? '  OK ' : '  XX '} ${msg}`);
  if (!cond) problemas.push(msg);
};
const MOVIL = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const ESCRITORIO = { width: 1440, height: 900, deviceScaleFactor: 1 };

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

async function generarFotos() {
  const p = await browser.newPage();
  await p.setViewport({ width: 1200, height: 800 });
  const archivos = [];
  for (const [i, color] of ['#2b3a55', '#553a2b', '#2b5540', '#4a2b55'].entries()) {
    await p.setContent(`<body style="margin:0;height:100vh;display:grid;place-items:center;background:${color};font:700 120px system-ui;color:#fff">TOMA ${i + 1}</body>`);
    const f = path.join(OUT, `toma-${i + 1}.jpg`);
    await p.screenshot({ path: f, type: 'jpeg', quality: 90 });
    archivos.push(f);
  }
  await p.close();
  return archivos;
}

async function ultimoLead() {
  const dirs = (await fs.readdir(LEADS)).sort();
  const dir = path.join(LEADS, dirs[dirs.length - 1]);
  return JSON.parse(await fs.readFile(path.join(dir, 'lead.json'), 'utf8'));
}

const abierto = (page) => page.$eval('#catalogo-marca', (e) => e.classList.contains('abierto'));
const valor = (page, sel) => page.$eval(sel, (e) => e.value);
async function centro(page, sel) {
  await page.$eval(sel, (e) => e.scrollIntoView({ block: 'center' }));
  await sleep(120);
  const caja = await page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  return caja;
}
async function tocar(page, sel) {
  const { x, y } = await centro(page, sel);
  await page.touchscreen.tap(x, y);
}

const fotos = await generarFotos();

/* ===================== Escritorio: mouse y teclado ===================== */
log('\n== Catálogo en escritorio (1440x900): mouse y teclado');
{
  const page = await nuevaPagina(ESCRITORIO, 'escritorio');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await page.click('#btn-empezar');
  await page.waitForSelector('#panel-vehiculo:not([hidden])');
  await sleep(500);

  await page.click('#marca');
  await sleep(700);
  check(await abierto(page), 'Al entrar a Marca se despliega el catálogo');
  const conteo = await page.evaluate(() => ({
    comunes: document.querySelectorAll('.grupo-comunes [role=option]').length,
    todas: document.querySelectorAll('.grupo-todas [role=option]:not([data-otra])').length,
    otra: document.querySelectorAll('[data-otra]').length,
    conLogo: document.querySelectorAll('.grupo-todas .marca-imagen').length,
    sinLogo: [...document.querySelectorAll('.grupo-todas .marca--texto')].map((e) => e.dataset.marca),
  }));
  check(
    conteo.comunes === 8 && conteo.todas === 51 && conteo.otra === 1 && conteo.conLogo === 45,
    `8 comunes, 51 marcas (45 con logo) y "Otra marca" (${JSON.stringify({ ...conteo, sinLogo: conteo.sinLogo.length })})`,
  );
  check(
    JSON.stringify(conteo.sinLogo) === JSON.stringify(['Chrysler', 'Dodge', 'DS', 'Jaguar', 'Seat', 'SsangYong']),
    `Sin logo, con el nombre escrito: ${conteo.sinLogo.join(', ')}`,
  );
  await page.waitForFunction(() => [...document.querySelectorAll('.marca-imagen')].every((i) => i.complete && i.naturalWidth > 0), { timeout: 10000 }).catch(() => {});
  const rotos = await page.$$eval('.marca-imagen', (els) => els.filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.src));
  check(rotos.length === 0, `Todos los logos cargan (${rotos.length} rotos)`);

  await page.hover('#lista-marca-c-ford');
  await sleep(450);
  const nombreVisible = await page.$eval('#lista-marca-c-ford .marca-nombre', (e) => getComputedStyle(e).opacity);
  check(Number(nombreVisible) > 0.95, `Con el mouse encima aparece el nombre (opacidad ${nombreVisible})`);
  await page.screenshot({ path: `${OUT}/c01-escritorio-hover.png` });

  await page.click('#lista-marca-c-ford');
  await sleep(500);
  const elegida = await page.evaluate(() => ({
    valor: document.querySelector('#marca').value,
    logo: !document.querySelector('.combo-marca .combo-logo').hidden,
    marcadas: document.querySelectorAll('[role=option][aria-selected=true]').length,
    placeholderModelo: document.querySelector('#modelo').placeholder,
  }));
  check(
    elegida.valor === 'Ford' && elegida.logo && elegida.marcadas === 2 && !(await abierto(page)),
    `Un clic elige: Ford en el campo, con su logo, y el catálogo se pliega (${JSON.stringify(elegida)})`,
  );
  check(elegida.placeholderModelo === 'Ej.: Ranger', `Modelo sugiere los modelos de la marca (${elegida.placeholderModelo})`);

  // Volver a abrir: se ven todas, con Ford marcada.
  await page.click('#toggle-marca');
  await sleep(600);
  const reabierto = await page.evaluate(() => ({
    visibles: [...document.querySelectorAll('#lista-marca [role=option]')].filter((e) => e.offsetParent).length,
    tilde: getComputedStyle(document.querySelector('#lista-marca-t-ford .marca-check')).display,
  }));
  check(reabierto.visibles === 60 && reabierto.tilde !== 'none', `Al volver a abrir se ven todas y Ford queda con tilde (${JSON.stringify(reabierto)})`);

  // Teclado: escribir filtra; las flechas recorren; Enter elige.
  await page.click('#marca', { count: 3 });
  await page.keyboard.type('che', { delay: 40 });
  await sleep(300);
  const filtradas = await page.$$eval('#lista-marca [role=option]', (els) => els.filter((e) => e.offsetParent).map((e) => e.dataset.marca || 'otra'));
  check(JSON.stringify(filtradas) === JSON.stringify(['Chery', 'Chevrolet', 'Porsche']), `Escribir "che" filtra (empieza con o contiene): ${filtradas.join(', ')}`);
  await page.keyboard.press('ArrowRight');
  const activa = await page.$eval('#marca', (e) => e.getAttribute('aria-activedescendant'));
  check(activa === 'lista-marca-t-chevrolet', `Las flechas mueven la opción activa (${activa})`);
  await page.keyboard.press('Enter');
  await sleep(300);
  check((await valor(page, '#marca')) === 'Chevrolet', 'Enter elige la opción activa: Chevrolet');

  // Una marca que no está: aviso y "Usar".
  await page.click('#marca', { count: 3 });
  await page.keyboard.type('Lada', { delay: 30 });
  await sleep(300);
  const aviso = await page.$eval('.catalogo-vacio', (e) => !e.hidden && e.textContent.includes('No encontramos'));
  check(aviso, 'Si la marca no está, avisa y ofrece dejarla escrita');
  await page.screenshot({ path: `${OUT}/c02-escritorio-sin-resultados.png` });
  await page.click('.vacio-usar');
  await sleep(300);
  const libre = await page.evaluate(() => ({ valor: document.querySelector('#marca').value, logo: !document.querySelector('.combo-marca .combo-logo').hidden }));
  check(libre.valor === 'Lada' && !libre.logo && !(await abierto(page)), `"Usar" deja la marca escrita, sin logo (${JSON.stringify(libre)})`);

  // Esc cierra.
  await page.click('#marca');
  await sleep(400);
  await page.keyboard.press('Escape');
  await sleep(150);
  check(!(await abierto(page)), 'Esc pliega el catálogo');
  await page.close();
}

/* ===================== Celular: un toque ===================== */
log('\n== Catálogo en el celular (390x844, táctil): un toque elige');
{
  const page = await nuevaPagina(MOVIL, 'movil');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await tocar(page, '#btn-empezar');
  await page.waitForSelector('#panel-vehiculo:not([hidden])');
  await sleep(600);

  await tocar(page, '#marca');
  await sleep(700);
  const sinTeclado = await page.$eval('#marca', (e) => e.getAttribute('inputmode'));
  check((await abierto(page)) && sinTeclado === 'none', `Tocar Marca despliega el catálogo sin abrir el teclado (inputmode=${sinTeclado})`);
  await page.screenshot({ path: `${OUT}/c03-celular-catalogo.png` });

  await tocar(page, '#lista-marca-c-toyota');
  await sleep(500);
  const unToque = await page.evaluate(() => ({
    valor: document.querySelector('#marca').value,
    logo: !document.querySelector('.combo-marca .combo-logo').hidden,
    marcadas: document.querySelectorAll('#lista-marca [role=option][aria-selected=true]').length,
  }));
  check(unToque.valor === 'Toyota' && unToque.logo && unToque.marcadas === 2 && !(await abierto(page)), `Un toque elige Toyota, muestra su logo en el campo y pliega el catálogo (${JSON.stringify(unToque)})`);

  // Cambiar de marca también es un solo toque.
  await tocar(page, '#marca');
  await sleep(600);
  await tocar(page, '#lista-marca-c-renault');
  await sleep(500);
  check((await valor(page, '#marca')) === 'Renault' && !(await abierto(page)), 'Un toque en otra marca la cambia (Renault)');

  // Con el catálogo abierto, un segundo toque en el campo abre el teclado para escribir.
  await tocar(page, '#marca');
  await sleep(600);
  await tocar(page, '#marca');
  await sleep(300);
  const escribir = await page.evaluate(() => ({ inputmode: document.querySelector('#marca').getAttribute('inputmode'), placeholder: document.querySelector('#marca').placeholder }));
  check(escribir.inputmode === null && escribir.placeholder === 'Escribí la marca', `Tocar otra vez el campo abre el teclado para escribir (${JSON.stringify(escribir)})`);
  await page.keyboard.press('Escape');
  await sleep(200);

  /* ---------- Fotos por toma ---------- */
  await page.$eval('#marca', (e) => { e.value = ''; });
  await page.type('#marca', 'Toyota');
  await page.keyboard.press('Tab');
  await page.type('#modelo', 'Corolla');
  await page.keyboard.press('Tab');
  await page.select('#anio', '2019');
  await page.click('#panel-vehiculo button[type=submit]');
  await page.waitForSelector('#panel-estado:not([hidden])');
  await sleep(600);
  await page.type('#kilometraje', '85000');
  await page.click('input[name=tuvo_reparacion][value=no]');
  await page.click('input[name=unica_mano][value=si]');

  const casillas = await page.$$eval('#fotos-grid > li', (els) => els.map((e) => `${e.dataset.toma}:${e.querySelector('.toma-nombre')?.textContent}`));
  check(casillas.length === 8 && casillas[0] === 'frente:Frente' && casillas[7] === 'baul:Baúl', `8 casillas con nombre (${casillas.map((c) => c.split(':')[1]).join(', ')})`);

  const [selector1] = await Promise.all([page.waitForFileChooser(), page.click('[data-toma="motor"] .toma-agregar')]);
  await selector1.accept([fotos[0]]);
  await page.waitForFunction(() => document.querySelector('[data-toma="motor"]')?.matches('.foto:not(.foto--cargando)'), { timeout: 15000 });
  const motor = await page.evaluate(() => ({
    contador: document.querySelector('#fotos-contador').textContent,
    alt: document.querySelector('[data-toma="motor"] img')?.alt,
    frente: document.querySelector('[data-toma="frente"]').classList.contains('foto'),
  }));
  check(motor.contador === '1 de 8' && motor.alt === 'Foto del motor' && !motor.frente, `Tocar "Motor" carga la foto en esa casilla (${JSON.stringify(motor)})`);

  const [selector2] = await Promise.all([page.waitForFileChooser(), page.click('#btn-agregar-fotos')]);
  await selector2.accept([fotos[1], fotos[2], fotos[3]]);
  await page.waitForFunction(() => document.querySelectorAll('#fotos-grid .foto:not(.foto--cargando)').length === 4, { timeout: 20000 });
  const llenas = await page.$$eval('#fotos-grid .foto', (els) => els.map((e) => e.dataset.toma));
  check(JSON.stringify(llenas) === JSON.stringify(['frente', 'trasera', 'lateral-izquierdo', 'motor']), `Varias juntas llenan las casillas libres en orden (${llenas.join(', ')})`);
  await page.$eval('#campo-fotos', (e) => e.scrollIntoView({ block: 'center' }));
  await sleep(300);
  await page.screenshot({ path: `${OUT}/c04-celular-fotos.png` });

  await page.click('[data-toma="trasera"] .foto-quitar');
  await sleep(200);
  const quitada = await page.evaluate(() => ({
    vacia: !document.querySelector('[data-toma="trasera"]').classList.contains('foto'),
    foco: document.activeElement?.getAttribute('aria-label'),
    contador: document.querySelector('#fotos-contador').textContent,
  }));
  check(quitada.vacia && quitada.foco === 'Agregar foto de la trasera' && quitada.contador === '3 de 8', `Quitar deja la casilla libre y el foco en ella (${JSON.stringify(quitada)})`);

  await page.click('#btn-continuar-estado');
  await page.waitForSelector('#panel-contacto:not([hidden])');
  await sleep(500);
  await page.type('#telefono', '11 2345 6789');
  await page.click('#btn-enviar');
  await page.waitForSelector('#panel-listo:not([hidden])', { timeout: 30000 });
  await sleep(600);
  const lead = await ultimoLead();
  const tomas = (lead.fotos_tomas || []).map((f) => `${f.toma}=${f.archivo}`);
  check(
    JSON.stringify(tomas) === JSON.stringify(['Frente=fotos/01-frente.jpg', 'Lateral izquierdo=fotos/02-lateral-izquierdo.jpg', 'Motor=fotos/03-motor.jpg']),
    `lead.json guarda cada foto con su toma (${tomas.join(' · ')})`,
  );
  await page.close();
}

await browser.close();
log(`\n${bien}/${total} checks`);
if (problemas.length) {
  log('\nProblemas:');
  for (const p of problemas) log(' -', p);
  process.exitCode = 1;
} else {
  log('Sin problemas de consola ni de red.');
}
