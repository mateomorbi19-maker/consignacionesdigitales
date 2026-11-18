/* =========================================================================
   Logos de las marcas para el catálogo del paso 1.
   - Archivos: img/marcas/<slug>.webp, en blanco sobre transparente (se ven
     sobre el negro de la marca). Salen de los logos que juntó el dueño,
     pasados a blanco y recortados; solo marcas que están en catalogo.js.
   - El número es el ancho con que se muestra cada logo (% de su tarjeta),
     calculado por área para que todos pesen parecido a la vista.
   - Las marcas cargadas sin logo (Chrysler, Dodge, DS, Jaguar, Seat,
     SsangYong) se muestran con el nombre escrito.
   ========================================================================= */

export const LOGOS_MARCAS = new Map([
  ["alfa-romeo", 35.1],
  ["audi", 72],
  ["baic", 72],
  ["bmw", 35.7],
  ["byd", 72],
  ["changan", 47.7],
  ["chery", 72],
  ["chevrolet", 55.2],
  ["citroen", 37.2],
  ["dfsk", 72],
  ["dongfeng", 41.8],
  ["fiat", 41.8],
  ["ford", 60.5],
  ["foton", 46],
  ["geely", 51.2],
  ["great-wall", 56.2],
  ["haval", 72],
  ["honda", 49.9],
  ["hyundai", 72],
  ["isuzu", 72],
  ["iveco", 71.7],
  ["jac", 72],
  ["jeep", 68.6],
  ["jetour", 72],
  ["jmc", 31.3],
  ["kaiyi", 72],
  ["kia", 72],
  ["land-rover", 67.9],
  ["lexus", 54.4],
  ["lifan", 68.6],
  ["mercedes-benz", 46.4],
  ["mini", 72],
  ["mitsubishi", 51.6],
  ["nissan", 54.8],
  ["peugeot", 32.2],
  ["porsche", 34.9],
  ["ram", 72],
  ["renault", 35.3],
  ["shineray", 72],
  ["smart", 38.6],
  ["subaru", 51.4],
  ["suzuki", 38.8],
  ["toyota", 56],
  ["volkswagen", 46],
  ["volvo", 46],
]);

/** Las 8 marcas más comunes en el mercado de usados: van primero en el catálogo. */
export const MARCAS_COMUNES = ["Volkswagen", "Ford", "Renault", "Chevrolet", "Fiat", "Peugeot", "Toyota", "Citroën"];
