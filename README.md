# Surcars · Formulario de consignación (campaña)

Landing con un formulario de 3 pasos para recibir tráfico de anuncios: personas que quieren vender su vehículo con la **consignación 100% digital** de Surcars.

## Verlo en tu compu

Requisito: [Node.js](https://nodejs.org) 20 o superior. No hay dependencias que instalar.

```bash
cd landing-consignacion
npm start
```

Abrí **http://localhost:3000**. Para cortarlo: `Ctrl + C`.

### Probarlo desde el celular

Con la compu y el celular en la misma red Wi-Fi:

```bash
npm run red
```

En el celular, abrí la dirección **Red** que muestra la consola (por ejemplo `http://192.168.0.23:3000`). La primera vez, Windows puede pedir permiso en el firewall. Usalo solo en redes de confianza: cualquiera en la misma red puede abrirlo.

## Publicarlo (Docker / Easypanel)

El repo trae un `Dockerfile`, así que Easypanel (o cualquier hosting con Docker) lo construye directo.

- **Puerto:** la app escucha en el **3000** dentro del contenedor. En Easypanel, el dominio apunta al puerto 3000. El HTTPS lo pone Easypanel.
- **Envíos:** se guardan en `/app/leads`. Para no perderlos en cada despliegue, montá un volumen ahí. En Easypanel, en Montajes, agregá un "Volume" con ruta `/app/leads`. Igual, el destino definitivo de los envíos sigue pendiente (ver abajo).
- **Sin Docker** (un servidor propio): `HOST=0.0.0.0 PORT=3000 npm start`, y adelante un proxy (Nginx o Caddy) con el dominio y el HTTPS.

## Flujo

1. **Portada**: título "Venta 100% digital", botón "Quiero vender mi vehículo", "Cómo funciona" en tres pasos y un cierre con el mismo botón.
2. **Paso 1 · Tu vehículo**: marca, modelo, versión y año.
   - **Marca** despliega un catálogo con los logos: primero las 8 más comunes en usados y después todas, de la A a la Z.
     - Con mouse: al pasar por un logo aparece el nombre, y un clic la elige.
     - En el celular: el primer toque muestra el nombre y el segundo la elige. Tocar el campo despliega el catálogo sin abrir el teclado; tocarlo otra vez abre el teclado.
     - Se puede escribir para filtrar. Si la marca no está, "Otra marca" (o escribirla y "Usar") la deja escrita igual.
   - **Modelo** sugiere los modelos de la marca elegida (608 en total) y también acepta texto libre.
   - **Versión** sugiere las versiones del modelo elegido y es opcional: si no la saben, marcan "No sé la versión" (o la dejan vacía) y siguen.
3. **Paso 2 · Estado y fotos**: kilometraje, golpes o reparaciones (si responde "Sí", se despliega el tipo y el detalle), única mano y las fotos.
   - Hay 8 casillas con nombre: Frente, Trasera, Lateral izquierdo, Lateral derecho, Interior, Tablero, Motor y Baúl.
   - Cada casilla carga su foto. Con "Agregar varias", las fotos llenan las casillas libres en orden.
   - Son opcionales pero recomendadas: si quiere seguir sin fotos, se le avisa una vez.
4. **Paso 3 · Contacto**: teléfono y email. Alcanza con uno de los dos, pero la pantalla no lo dice. Si faltan ambos, se marcan los dos y no se puede enviar.
5. **Confirmación** con el resumen de lo enviado.

Además:

- Las fotos se comprimen en el celular antes de subirlas (máx. 1600 px) y se les quitan los datos de ubicación GPS.
- Si se recarga la página, no se pierden los datos cargados. Las fotos sí se pierden, y en ese caso se avisa.
- El botón "atrás" del celular vuelve al paso anterior. Mientras se envía, el formulario queda bloqueado.
- Si el envío falla por la conexión, se puede reintentar o mandar solo los datos, sin las fotos. Los reintentos no duplican el envío.

## Catálogo de vehículos

- `public/js/catalogo.js`: marcas y modelos, verificados contra Autocosmos, Kavak AR, Mercado Libre y tablas DNRPA.
- `public/data/versiones/<marca>.json`: versiones por modelo (3011 versiones para 584 de los 608 modelos), verificadas contra la guía de precios de Autocosmos, notas de lanzamiento argentinas, Kavak y sitios oficiales. Se descargan solo cuando se elige la marca, así no pesan en la carga inicial.
- `public/js/marcas-logos.js` y `public/img/marcas/`: logos de 45 marcas, en blanco sobre transparente, sacados de los logos que juntó el dueño.
  - Solo hay logos de marcas cargadas en el catálogo. Great Wall usa el logo GWM.
  - Las 6 marcas cargadas sin logo (Chrysler, Dodge, DS, Jaguar, Seat y SsangYong) se muestran con el nombre escrito.
  - Se descargan recién cuando se abre el catálogo.
  - Al lado de cada imagen hay un `.json` que registra de dónde salió.

## Dónde quedan los envíos

En `leads/`, una carpeta por envío:

```
leads/2026-11-17_15-30-12_toyota-corolla-2019_a1b2c3/
  lead.json        ← datos del vehículo, origen del anuncio (UTM) y la toma de cada foto
  fotos/01-frente.jpg, 02-trasera.jpg …
```

En `lead.json`, `fotos` tiene las rutas y `fotos_tomas` dice qué toma es cada foto (por ejemplo `{"toma": "Frente", "archivo": "fotos/01-frente.jpg"}`).

> Esto es para probar en local. En producción se reemplaza por el destino real (CRM, mail, planilla, etc.). El formulario envía a `/api/leads`; la dirección se cambia en `public/js/app.js` (`CONFIG.endpoint`).

## Medición de la campaña

- Cada envío guarda las UTM y los IDs de clic de los anuncios (`utm_*`, `fbclid`, `gclid`, …).
- Eventos en `dataLayer` (listos para Google Tag Manager): `consignacion_inicio`, `consignacion_vehiculo`, `consignacion_estado` y `consignacion_lead`.
- Si se instalan Meta Pixel o GA4, al enviar se dispara `Lead` o `generate_lead` automáticamente.

## Diseño

- **Dirección:** "Lo estándar del rubro", con la vara de terminación de Tesla. La eligió el dueño el 2026-11-18 con el skill Impeccable y vale solo para esta landing.
- **Sistema visual:** [`DESIGN.md`](DESIGN.md) (colores, tipografía, componentes y reglas). Es de esta landing: la app de Surcars va a tener el suyo.
- **Base:**
  - Paleta "Neón" de la marca (ver `CLAUDE.md`).
  - Tipografía Manrope, servida desde el propio sitio.
  - Foto de portada: una foto de stock ilustrativa (Pexels, n.º 19067088), rotulada "Foto ilustrativa" hasta tener fotos propias.
- **Material de referencia:**
  - Contrato de dirección y restricciones: `../.impeccable/surfaces/landing-consignacion-public-index-html.md`.
  - Boceto elegido: `../.impeccable/decision-elegida/canon-elegido.html`.
  - Capturas de la última revisión: `../.impeccable/review/`.

## Estructura

```
landing-consignacion/
├─ server.js             servidor local (archivos + recepción de envíos)
├─ Dockerfile            imagen para publicarla (Easypanel u otro hosting con Docker)
├─ DESIGN.md             sistema visual de esta landing
├─ public/
│  ├─ index.html         pantallas
│  ├─ css/tokens.css     paleta Neón (único lugar con colores)
│  ├─ css/styles.css     componentes
│  ├─ css/fuentes.css    tipografía servida desde el sitio
│  ├─ fonts/             Manrope (licencia OFL)
│  ├─ img/               logo de Surcars, foto de portada y logos de marcas (img/marcas/)
│  ├─ data/versiones/    versiones por marca (JSON)
│  └─ js/                app.js (flujo), catalogo-marcas.js (catálogo de logos), marcas-logos.js,
│                        combobox.js, fotos.js, origen.js, catalogo.js
├─ pruebas/              pruebas automáticas en Edge (ver pruebas/README.md)
└─ leads/                envíos recibidos (se crea solo; no se versiona)
```

## Pendientes antes de salir con la campaña

- **Destino de los envíos** en producción, y **hosting/dominio**.
- **Política de privacidad** (Ley 25.326 de Protección de Datos Personales). El formulario pide teléfono y email, así que hay que enlazarla junto a la nota "Al enviar, aceptás…".
- **Píxeles** (Meta / Google).
- **Logo en alta resolución**: el original es de 150 × 150 px. Con una versión más grande o en SVG se ve nítido también en tamaños grandes.
- **Foto propia para la portada**: la de stock es ilustrativa y muestra una camioneta de una marca real.
- **Logos que faltan**: Chrysler, Dodge, DS, Jaguar, Seat y SsangYong (hoy van con el nombre escrito).
