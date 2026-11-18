// E2E de robustez del formulario (envío lento, caída de red, recarga) con Edge headless. Uso: node e2e-robustez.mjs <carpetaCapturas> <carpetaLeads>
import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:3000';
const OUT = path.resolve(process.argv[2] || './shots-extra-v3');
const LEADS = process.argv[3];
await fs.mkdir(OUT, { recursive: true });

const problemas = [];
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (cond, msg) => { log(`${cond ? '  OK ' : '  XX '} ${msg}`); if (!cond) problemas.push(msg); };
const MOVIL = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-first-run', '--disable-extensions'] });

async function nuevaPagina(etiqueta) {
  const page = await browser.newPage();
  await page.setViewport(MOVIL);
  page.on('pageerror', (e) => problemas.push(`[${etiqueta} pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('net::ERR_FAILED')) problemas.push(`[${etiqueta} console] ${m.text()}`); });
  return page;
}

const foto = path.join(OUT, 'foto-prueba.jpg');
{
  const p = await browser.newPage();
  await p.setViewport({ width: 1200, height: 800 });
  await p.setContent('<body style="margin:0;height:100vh;background:linear-gradient(135deg,#334,#99a)"></body>');
  await p.screenshot({ path: foto, type: 'jpeg', quality: 90 });
  await p.close();
}

async function hastaPaso2(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await page.click('#btn-empezar');
  await page.waitForSelector('#panel-vehiculo:not([hidden])');
  await page.type('#marca', 'Toyota');
  await page.keyboard.press('Tab');
  await page.type('#modelo', 'Corolla');
  await page.keyboard.press('Tab');
  await page.select('#anio', '2019');
  await page.click('#panel-vehiculo button[type=submit]');
  await page.waitForSelector('#panel-estado:not([hidden])');
  await page.type('#kilometraje', '85000');
  await page.click('input[name=tuvo_reparacion][value=no]');
  await page.click('input[name=unica_mano][value=si]');
}
async function agregarFoto(page) {
  await (await page.$('#input-fotos')).uploadFile(foto);
  await page.waitForFunction(() => document.querySelectorAll('#fotos-grid .foto:not(.foto--cargando)').length >= 1, { timeout: 15000 });
}
async function hastaPaso3(page, { conFoto = true } = {}) {
  await hastaPaso2(page);
  if (conFoto) await agregarFoto(page);
  await page.click('#btn-continuar-estado');
  if (!conFoto) { await sleep(300); await page.click('#btn-continuar-estado'); }
  await page.waitForSelector('#panel-contacto:not([hidden])');
  await page.type('#telefono', '11 2345 6789');
}

log('\n== Kilometraje: borrar junto al punto');
{
  const page = await nuevaPagina('km');
  await hastaPaso2(page);
  await page.click('#kilometraje');
  await page.$eval('#kilometraje', (e) => e.setSelectionRange(3, 3));
  await page.keyboard.press('Backspace');
  check((await page.$eval('#kilometraje', (e) => e.value)) === '8.000', 'Retroceso después del punto borra el dígito anterior');
  await page.close();
}

log('\n== Envío lento: bloqueo y datos consistentes');
{
  const page = await nuevaPagina('lento');
  await hastaPaso3(page);
  await page.setRequestInterception(true);
  let posts = 0;
  page.on('request', async (r) => {
    if (r.url().endsWith('/api/leads') && r.method() === 'POST') { posts += 1; await sleep(2500); r.continue(); } else r.continue();
  });
  await page.click('#btn-enviar');
  await sleep(600);
  check(await page.evaluate(() => ['vehiculo', 'estado', 'contacto'].every((p) => document.querySelector(`#panel-${p}`).inert)), 'Durante el envío los 3 pasos quedan bloqueados');
  await page.evaluate(() => history.back());
  await sleep(400);
  check((await page.evaluate(() => document.body.dataset.paso)) === 'contacto', 'El "atrás" durante el envío no saca del paso 3');
  await page.waitForSelector('#panel-listo:not([hidden])', { timeout: 15000 });
  check(posts === 1, `Un solo envío (${posts})`);
  await page.close();
}

log('\n== Falla de red con fotos: "Enviar sin fotos"');
{
  const page = await nuevaPagina('caida');
  await hastaPaso3(page);
  await page.setRequestInterception(true);
  let intentos = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/api/leads') && r.method() === 'POST') { intentos += 1; if (intentos === 1) r.abort('failed'); else r.continue(); } else r.continue();
  });
  await page.click('#btn-enviar');
  await page.waitForSelector('#error-envio:not([hidden]) button', { timeout: 10000 });
  check((await page.evaluate(() => document.activeElement?.id)) === 'error-envio', 'El foco va al mensaje de error (en el paso 3)');
  await page.screenshot({ path: `${OUT}/x01-error.png` });
  await page.click('#error-envio button');
  await page.waitForSelector('#panel-listo:not([hidden])', { timeout: 15000 });
  const dirs = (await fs.readdir(LEADS)).sort();
  const lead = JSON.parse(await fs.readFile(path.join(LEADS, dirs[dirs.length - 1], 'lead.json'), 'utf8'));
  check(lead.fotos.length === 0 && lead.contacto.telefono === '11 2345 6789', 'Se envió sin fotos y con el teléfono');
  await page.close();
}

log('\n== Aviso sin fotos: foco al agregar desde el aviso');
{
  const page = await nuevaPagina('nudge');
  await hastaPaso2(page);
  await page.click('#btn-continuar-estado');
  await page.waitForSelector('#nudge-fotos:not([hidden])');
  await page.focus('#nudge-agregar');
  await agregarFoto(page);
  await sleep(200);
  check(await page.$eval('#nudge-fotos', (e) => e.hidden), 'El aviso se oculta al agregar una foto');
  check((await page.evaluate(() => document.activeElement?.id)) === 'btn-continuar-estado', 'El foco pasa a "Continuar"');
  check((await page.$eval('#btn-continuar-estado', (e) => e.textContent.trim())) === 'Continuar', 'El botón vuelve a decir "Continuar"');
  await page.close();
}

log('\n== Recarga con fotos cargadas');
{
  const page = await nuevaPagina('recarga');
  await hastaPaso2(page);
  await agregarFoto(page);
  await sleep(400);
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(300);
  check((await page.$eval('#fotos-aviso', (e) => e.textContent)).startsWith('Se recargó la página'), 'Avisa que las fotos se perdieron');
  await page.close();
}

log('\n== "Adelante" al paso 3 con el paso 2 incompleto');
{
  const page = await nuevaPagina('adelante');
  await hastaPaso3(page);
  await page.evaluate(() => history.back());
  await page.waitForSelector('#panel-estado:not([hidden])');
  await page.$eval('#kilometraje', (e) => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(100);
  await page.evaluate(() => history.forward());
  await sleep(600);
  check((await page.evaluate(() => document.body.dataset.paso)) === 'estado', 'Se queda en el paso 2');
  check((await page.$eval('#error-kilometraje', (e) => e.textContent)) === 'Ingresá el kilometraje.', 'Y muestra qué falta');
  await page.close();
}

await browser.close();
log('\n== Problemas');
if (!problemas.length) log('  (ninguno)');
for (const p of problemas) log(`  - ${p}`);
process.exitCode = problemas.length ? 1 : 0;
