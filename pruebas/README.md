# Pruebas del formulario

Pruebas automáticas que recorren el formulario en un navegador real (Microsoft Edge en modo invisible). No forman parte de la landing: la landing sigue sin dependencias.

## Correrlas

1. En una terminal, levantá la landing: `cd landing-consignacion` y `npm start` (queda en http://127.0.0.1:3000).
2. En otra terminal, en esta carpeta: `npm install` (solo la primera vez; instala `puppeteer-core`).
3. `npm run flujo`: recorre los 3 pasos, la confirmación, los errores y los tamaños de celular y escritorio. También verifica que cada foto llegue con su toma. Resultado esperado: **43/43**.
4. `npm run robustez`: reintentos, envío sin duplicar, error de conexión y bloqueo mientras envía. Resultado esperado: **12/12**.
5. `npm run catalogo`: prueba el catálogo de marcas y las fotos por toma. Resultado esperado: **25/25**.
   - Catálogo con mouse y teclado: nombre al pasar, clic, flechas, filtro, "Usar" y Esc.
   - Catálogo con dos toques en el celular, y el teclado recién al segundo toque en el campo.
   - Fotos: cada una en su casilla, varias juntas en orden, quitar, y su toma en `lead.json`.
6. `npm run email`: prueba el aviso por email con un servidor de correo falso. No necesita la landing levantada ni Edge, no manda mails reales y no toca `../leads`. Resultado esperado: **17/17**.
   - Con el aviso configurado: el mail llega con asunto, resumen, "Responder" al vendedor y las fotos adjuntas.
   - Si la clave es incorrecta, el vendedor igual ve su envío confirmado.
   - Sin configurar, el formulario funciona igual.

Cada script imprime una línea `OK` o `XX` por check y al final los problemas de consola o de red. Si hay alguno, termina con error. Las capturas quedan en `capturas/`. Edge tiene que estar en `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`.

## Después de correrlas

Las pruebas crean envíos de prueba en `../leads/`. Borrá **solo** los que tengan `HeadlessChrome` en `tecnico.user_agent` de su `lead.json`. Nunca borres la carpeta entera: ahí hay envíos reales, como el del Toyota Hilux 2024 que cargó el dueño.

## Si fallan después de tocar el diseño

El diseño cambia la presentación, no el comportamiento. Si estas pruebas fallan después de tocar el HTML o el CSS, se rompió algo que usa `js/app.js`. Revisá los ids, los `data-*` y las clases que lista el brief en `.impeccable/surfaces/`.

Las pruebas también dependen de esto:

- `.marca-logo` es solo el logo de Surcars del encabezado.
- `.paso-numero` dice "Paso N de 3".
- `.error` se usa solo para los mensajes de error de cada campo.
- `.foto` va solo en las casillas que tienen foto.
- `#input-fotos` acepta varias fotos a la vez.

`render-boceto.mjs` saca capturas de celular de cualquier HTML: `node render-boceto.mjs <archivo.html> <prefijo>`.
