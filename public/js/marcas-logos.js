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
  ["alfa-romeo", 38.8],
  ["audi", 65.4],
  ["baic", 74],
  ["bmw", 38.4],
  ["byd", 74],
  ["changan", 55.5],
  ["chery", 70.4],
  ["chevrolet", 50],
  ["citroen", 45.2],
  ["dfsk", 74],
  ["dongfeng", 43.9],
  ["fiat", 41.3],
  ["ford", 59.5],
  ["foton", 49],
  ["geely", 49.7],
  ["great-wall", 47.2],
  ["haval", 74],
  ["honda", 39.8],
  ["hyundai", 58.5],
  ["isuzu", 74],
  ["iveco", 73.4],
  ["jac", 63.3],
  ["jeep", 61.3],
  ["jetour", 74],
  ["jmc", 28.6],
  ["kaiyi", 66.1],
  ["kia", 74],
  ["land-rover", 56.5],
  ["lexus", 54.9],
  ["lifan", 53.7],
  ["mercedes-benz", 62.4],
  ["mini", 66.5],
  ["mitsubishi", 40.8],
  ["nissan", 51.6],
  ["peugeot", 33.2],
  ["porsche", 33.4],
  ["ram", 74],
  ["renault", 49.1],
  ["shineray", 57],
  ["smart", 32.3],
  ["subaru", 49.3],
  ["suzuki", 50.8],
  ["toyota", 48.9],
  ["volkswagen", 41.9],
  ["volvo", 42.7],
]);

/** Las 8 marcas más comunes en el mercado de usados: van primero en el catálogo. */
export const MARCAS_COMUNES = ["Volkswagen", "Ford", "Renault", "Chevrolet", "Fiat", "Peugeot", "Toyota", "Citroën"];
