// Renderiza un boceto HTML en tamaño celular y saca dos capturas:
//   <salida>-pantalla.png  (primer viewport 390x844, lo que ve el dueño primero)
//   <salida>-completo.png  (página entera)
// Uso: node render-boceto.mjs <archivo.html> <prefijoSalida> [ancho] [alto]
// Imprime: fuentes cargadas, desborde horizontal y errores de consola.
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';

const [, , archivo, salida, ancho = '390', alto = '844'] = process.argv;
if (!archivo || !salida) {
  console.error('Uso: node render-boceto.mjs <archivo.html> <prefijoSalida> [ancho] [alto]');
  process.exit(2);
}
const W = Number(ancho);
const H = Number(alto);
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
});
const problemas = [];
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 2, isMobile: W < 700, hasTouch: W < 700 });
page.on('pageerror', (e) => problemas.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problemas.push(`console: ${m.text()}`); });
page.on('requestfailed', (r) => problemas.push(`requestfailed: ${r.url().slice(0, 120)}`));
await page.goto(pathToFileURL(archivo).href, { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
// Desactiva animaciones de entrada para capturar el estado final.
await page.addStyleTag({ content: '*,*::before,*::after{animation-delay:0s!important;animation-duration:0s!important;transition:none!important}' });
await new Promise((r) => setTimeout(r, 400));
const info = await page.evaluate(() => {
  const fuentes = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight} ${f.style}`);
  const familias = [...new Set([...document.querySelectorAll('body *')].map((el) => getComputedStyle(el).fontFamily.split(',')[0].trim()))];
  return {
    fuentesCargadas: [...new Set(fuentes)],
    familiasUsadas: familias.slice(0, 12),
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    altoTotal: document.documentElement.scrollHeight,
  };
});
await page.screenshot({ path: `${salida}-pantalla.png` });
await page.screenshot({ path: `${salida}-completo.png`, fullPage: true });
await browser.close();
console.log(JSON.stringify({ ...info, desbordeHorizontal: info.scrollWidth > info.innerWidth, problemas }, null, 2));
