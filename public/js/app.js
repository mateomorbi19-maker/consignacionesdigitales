/* =========================================================================
   Surcars · Formulario de consignación 100% digital (campaña de anuncios)
   Flujo: intro → paso 1 (vehículo) → paso 2 (estado y fotos) → paso 3 (contacto) → listo
   ========================================================================= */

import { CATALOGO } from './catalogo.js';
import { crearCatalogoMarcas } from './catalogo-marcas.js';
import { crearCombobox, normalizar } from './combobox.js';
import { crearGestorFotos } from './fotos.js';
import { LOGOS_MARCAS, MARCAS_COMUNES } from './marcas-logos.js';
import { capturarOrigen, track } from './origen.js';

const CONFIG = {
  endpoint: '/api/leads', // destino de los envíos (en local lo atiende server.js)
  anioMinimo: 1980,
  kmMaximo: 999999,
  maxFotos: 8,
  // El envío se corta solo si deja de avanzar este tiempo (no por tardar: en 3G subir fotos lleva minutos).
  inactividadEnvioMs: 30000,
};

const CLAVE_BORRADOR = 'surcars:consignacion:borrador';
const HASH_DE_PASO = { intro: '', vehiculo: '#vehiculo', estado: '#estado', contacto: '#contacto', listo: '#listo' };
const PASO_DE_HASH = { '#vehiculo': 'vehiculo', '#estado': 'estado', '#contacto': 'contacto', '#listo': 'listo' };
const PASO_PREVIO = { vehiculo: 'intro', estado: 'vehiculo', contacto: 'estado' };
const PASOS_DEL_FORMULARIO = ['vehiculo', 'estado', 'contacto'];
const CAMPOS_DEL_PASO = {
  vehiculo: ['marca', 'modelo', 'version', 'anio'],
  estado: ['kilometraje', 'golpe', 'tipoReparacion', 'detalleReparacion', 'unicaMano'],
  contacto: ['telefono', 'email'],
};
const NOMBRE_TIPO = { mecanica: 'mecánica', estetica: 'estética' };

const $ = (selector, raiz = document) => raiz.querySelector(selector);
const $$ = (selector, raiz = document) => Array.from(raiz.querySelectorAll(selector));
const sinAnimaciones = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const comportamientoScroll = () => (sinAnimaciones() ? 'auto' : 'smooth');

/* ---------- Elementos ---------- */
const form = $('#form-consignacion');
const paneles = {
  intro: $('#panel-intro'),
  vehiculo: $('#panel-vehiculo'),
  estado: $('#panel-estado'),
  contacto: $('#panel-contacto'),
  listo: $('#panel-listo'),
};
const campos = {
  marca: $('#marca'),
  modelo: $('#modelo'),
  version: $('#version'),
  versionDesconocida: $('#version-desconocida'),
  anio: $('#anio'),
  kilometraje: $('#kilometraje'),
  detalle: $('#detalle-reparacion'),
  telefono: $('#telefono'),
  email: $('#email'),
};
const desplegableReparacion = $('#reparacion');
const nudgeFotos = $('#nudge-fotos');
const errorEnvio = $('#error-envio');
const btnContinuarEstado = $('#btn-continuar-estado');
const etiquetaContinuarEstado = $('.btn-etiqueta', btnContinuarEstado);
const btnEnviar = $('#btn-enviar');
const etiquetaEnviar = $('.btn-etiqueta', btnEnviar);
const regionAnuncios = $('#anuncio');

/* ---------- Estado ---------- */
const origen = capturarOrigen();
const intentado = { vehiculo: false, estado: false, contacto: false };
let pasoActual = 'intro';
let enviado = false;
let enviando = false;
let avisoSinFotosMostrado = false;
let marcaConfirmada = '';
let modeloConfirmado = '';
let saliendoDeIntro = false;
let preparandoFotos = false;
let pasoARevisarAlVolver = ''; // paso incompleto al que se volvió por historial (para mostrar qué falta)
// Identifica un envío lógico: se conserva entre reintentos para que el servidor no duplique el lead.
let idDeEnvio = '';

/* ---------- Utilidades ---------- */
let temporizadorAnuncio;
function anunciar(mensaje) {
  window.clearTimeout(temporizadorAnuncio);
  regionAnuncios.textContent = '';
  temporizadorAnuncio = window.setTimeout(() => {
    regionAnuncios.textContent = mensaje;
  }, 80);
}
const formatearMiles = (numero) => String(numero).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const textoDe = (elemento) => elemento.value.replace(/\s+/g, ' ').trim();
const valorRadio = (nombre) => form.querySelector(`input[name="${nombre}"]:checked`)?.value ?? '';
const tiposMarcados = () => $$('input[name="tipo_reparacion"]:checked', form).map((casilla) => casilla.value);
function marcarRadio(nombre, valor) {
  for (const radio of $$(`input[name="${nombre}"]`, form)) radio.checked = radio.value === valor;
}
const datosParaMedicion = () => ({ marca: textoDe(campos.marca), modelo: textoDe(campos.modelo), anio: campos.anio.value });
/** Versión cargada, o '' si no la saben (chip marcado o campo vacío). */
const versionElegida = () => (campos.versionDesconocida.checked ? '' : textoDe(campos.version));
/** Paso al que pertenece un elemento del formulario. */
const pasoDe = (elemento) => PASOS_DEL_FORMULARIO.find((paso) => paneles[paso].contains(elemento)) ?? pasoActual;
/** Teléfono: solo números y separadores comunes, entre 8 y 15 dígitos (código de área incluido). */
const telefonoValido = (texto) => /^[+\d\s().-]+$/.test(texto) && /^\d{8,15}$/.test(texto.replace(/\D/g, ''));
const emailValido = (texto) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(texto);

function nuevoIdDeEnvio() {
  try {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  } catch {
    /* fuera de https no hay randomUUID: usamos el respaldo */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/* ---------- Fotos ---------- */
const fotos = crearGestorFotos({
  zona: $('#campo-fotos'),
  grid: $('#fotos-grid'),
  input: $('#input-fotos'),
  boton: $('#btn-agregar-fotos'),
  contador: $('#fotos-contador'),
  aviso: $('#fotos-aviso'),
  maximo: CONFIG.maxFotos,
  anunciar,
  alCambiar: () => {
    if (!enviando) idDeEnvio = ''; // cambiaron los datos: si reintentan, es un envío nuevo
    actualizarAvisoSinFotos();
  },
});

/* ---------- Catálogo: sugerencias de marca, modelo y versión ---------- */
const MARCAS = CATALOGO.map(({ marca }) => marca).sort((a, b) => a.localeCompare(b, 'es'));
const MODELOS = new Map(CATALOGO.map(({ marca, modelos }) => [normalizar(marca), modelos]));
const modelosDe = (marca) => MODELOS.get(normalizar(marca)) ?? [];
const marcaCanonica = (valor) => MARCAS.find((marca) => normalizar(marca) === normalizar(valor));
const slug = (texto) => normalizar(texto).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Las versiones se descargan por marca recién cuando hacen falta (no suman peso a la carga inicial).
const versionesPorMarca = new Map(); // slug de la marca → Map(modelo normalizado → versiones)
const descargasDeVersiones = new Map();

function cargarVersiones(marca) {
  const canonica = marcaCanonica(marca);
  if (!canonica) return Promise.resolve();
  const clave = slug(canonica);
  if (versionesPorMarca.has(clave)) return Promise.resolve();
  if (descargasDeVersiones.has(clave)) return descargasDeVersiones.get(clave);
  const descarga = fetch(`data/versiones/${clave}.json`, { headers: { Accept: 'application/json' } })
    .then((respuesta) => (respuesta.ok ? respuesta.json() : {}))
    .then((datos) => {
      const porModelo = new Map();
      for (const [modelo, versiones] of Object.entries(datos && typeof datos === 'object' ? datos : {})) {
        if (Array.isArray(versiones)) porModelo.set(normalizar(modelo), versiones.filter((v) => typeof v === 'string'));
      }
      versionesPorMarca.set(clave, porModelo);
      comboVersion.actualizar();
      actualizarPlaceholderVersion();
    })
    .catch(() => {
      /* sin conexión o sin datos: la versión se puede escribir igual (y se reintenta más tarde) */
    })
    .finally(() => descargasDeVersiones.delete(clave));
  descargasDeVersiones.set(clave, descarga);
  return descarga;
}

function versionesDe(marca, modelo) {
  const canonica = marcaCanonica(marca);
  if (!canonica) return [];
  return versionesPorMarca.get(slug(canonica))?.get(normalizar(modelo)) ?? [];
}

// Marca: catálogo de logos. Confirma igual que los demás combos (elegir, Enter, Tab o salir del campo).
const comboMarca = crearCatalogoMarcas({
  input: campos.marca,
  boton: $('#toggle-marca'),
  catalogo: $('#catalogo-marca'),
  lista: $('#lista-marca'),
  vacio: $('#catalogo-marca .catalogo-vacio'),
  logoCampo: $('.combo-marca .combo-logo'),
  marcas: MARCAS,
  comunes: MARCAS_COMUNES.filter((marca) => MARCAS.includes(marca)),
  logos: LOGOS_MARCAS,
  slug,
  alConfirmar: confirmarMarca,
});
const comboModelo = crearCombobox({
  input: campos.modelo,
  lista: $('#lista-modelo'),
  boton: $('#toggle-modelo'),
  opciones: () => modelosDe(campos.marca.value),
  alConfirmar: confirmarModelo,
});
const comboVersion = crearCombobox({
  input: campos.version,
  lista: $('#lista-version'),
  boton: $('#toggle-version'),
  opciones: () => versionesDe(campos.marca.value, campos.modelo.value),
  alConfirmar: () => guardarBorradorPronto(),
});

function confirmarMarca(valor) {
  // Un campo vacío no "confirma" nada: si borran la marca y escriben otra, igual se detecta el cambio.
  if (!normalizar(valor)) {
    guardarBorradorPronto();
    return;
  }
  const anterior = marcaConfirmada;
  marcaConfirmada = valor;
  cargarVersiones(valor);
  comboModelo.actualizar();
  actualizarPlaceholderModelo();
  // Si cambió la marca y el modelo cargado no es de la nueva marca, se limpian modelo y versión.
  if (anterior && normalizar(anterior) !== normalizar(valor)) {
    const modelos = modelosDe(valor);
    const modelo = textoDe(campos.modelo);
    if (modelo && modelos.length && !modelos.some((opcion) => normalizar(opcion) === normalizar(modelo))) {
      campos.modelo.value = '';
      campos.version.value = '';
      modeloConfirmado = '';
      mostrarError('modelo', '');
    }
  }
  comboVersion.actualizar();
  actualizarPlaceholderVersion();
  guardarBorradorPronto();
}

function confirmarModelo(valor) {
  if (!normalizar(valor)) {
    guardarBorradorPronto();
    return;
  }
  const anterior = modeloConfirmado;
  modeloConfirmado = valor;
  comboVersion.actualizar();
  actualizarPlaceholderVersion();
  // Si cambió el modelo y la versión cargada no es de ese modelo, se limpia.
  if (anterior && normalizar(anterior) !== normalizar(valor)) {
    const versiones = versionesDe(campos.marca.value, valor);
    const version = textoDe(campos.version);
    if (version && versiones.length && !versiones.some((opcion) => normalizar(opcion) === normalizar(version))) {
      campos.version.value = '';
    }
  }
  guardarBorradorPronto();
}

function actualizarPlaceholderModelo() {
  const modelos = modelosDe(campos.marca.value);
  campos.modelo.placeholder = modelos.length ? `Ej.: ${modelos[0]}` : 'Ej.: Gol Trend';
}

function actualizarPlaceholderVersion() {
  if (campos.versionDesconocida.checked) {
    campos.version.placeholder = 'Sin especificar';
    return;
  }
  const versiones = versionesDe(campos.marca.value, campos.modelo.value);
  campos.version.placeholder = versiones.length ? `Ej.: ${versiones[0]}` : 'Ej.: 1.6 Highline';
}

campos.marca.addEventListener('input', () => {
  comboModelo.actualizar();
  comboVersion.actualizar();
  actualizarPlaceholderModelo();
  actualizarPlaceholderVersion();
});
campos.modelo.addEventListener('input', () => {
  comboVersion.actualizar();
  actualizarPlaceholderVersion();
});

/* "No sé la versión": permite seguir sin elegirla (además, la versión ya es opcional). */
function aplicarVersionDesconocida({ enfocar = false } = {}) {
  const desconocida = campos.versionDesconocida.checked;
  if (desconocida) {
    campos.version.value = '';
    comboVersion.cerrar();
  }
  campos.version.disabled = desconocida;
  comboVersion.actualizar();
  actualizarPlaceholderVersion();
  if (!desconocida && enfocar) campos.version.focus();
}
campos.versionDesconocida.addEventListener('change', () => aplicarVersionDesconocida({ enfocar: true }));

function poblarAnios() {
  const actual = new Date().getFullYear();
  const opciones = document.createDocumentFragment();
  for (let anio = actual; anio >= CONFIG.anioMinimo; anio -= 1) opciones.append(new Option(String(anio), String(anio)));
  campos.anio.append(opciones);
}

/* ---------- Kilometraje (formato 85.000) ---------- */
function leerKm() {
  const digitos = campos.kilometraje.value.replace(/\D/g, '');
  return digitos ? Number(digitos) : null;
}

let kmPrevio = '';
function formatearKm(evento) {
  const input = campos.kilometraje;
  let valor = input.value;
  let cursor = input.selectionStart ?? valor.length;
  // Si la tecla solo borró un punto de miles, se borra también el dígito de al lado
  // (si no, el punto vuelve a aparecer y parece que la tecla no hizo nada).
  const tipo = evento?.inputType;
  const borrado = tipo === 'deleteContentBackward' || tipo === 'deleteContentForward';
  if (borrado && valor !== kmPrevio && valor.replace(/\D/g, '') === kmPrevio.replace(/\D/g, '')) {
    if (tipo === 'deleteContentBackward' && cursor > 0) {
      valor = valor.slice(0, cursor - 1) + valor.slice(cursor);
      cursor -= 1;
    } else if (tipo === 'deleteContentForward') {
      valor = valor.slice(0, cursor) + valor.slice(cursor + 1);
    }
  }
  const digitosAntes = valor.slice(0, cursor).replace(/\D/g, '').length;
  const digitos = valor.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 7);
  const formateado = formatearMiles(digitos);
  kmPrevio = formateado;
  if (formateado === input.value) return;
  input.value = formateado;
  if (document.activeElement !== input) return;
  // Deja el cursor después del mismo dígito en el que estaba.
  const objetivo = Math.min(digitosAntes, digitos.length);
  let posicion = 0;
  let vistos = 0;
  while (posicion < formateado.length && vistos < objetivo) {
    if (/\d/.test(formateado[posicion])) vistos += 1;
    posicion += 1;
  }
  input.setSelectionRange(posicion, posicion);
}
campos.kilometraje.addEventListener('input', formatearKm);

/* ---------- Golpes o reparaciones: sección desplegable ---------- */
function actualizarDesplegable({ avisar = false } = {}) {
  const abrir = valorRadio('tuvo_reparacion') === 'si';
  const estabaAbierto = desplegableReparacion.classList.contains('abierto');
  desplegableReparacion.classList.toggle('abierto', abrir);
  if (avisar && abrir && !estabaAbierto) anunciar('Se agregaron preguntas sobre la reparación.');
}

/* ---------- Validación ---------- */
const VALIDADORES = {
  marca: () => (textoDe(campos.marca) ? '' : 'Ingresá la marca.'),
  modelo: () => (textoDe(campos.modelo) ? '' : 'Ingresá el modelo.'),
  version: () => '', // opcional: si no la saben, pueden seguir (o marcar "No sé la versión")
  anio: () => (campos.anio.value ? '' : 'Elegí el año.'),
  kilometraje: () => {
    const km = leerKm();
    if (km === null) return 'Ingresá el kilometraje.';
    if (km > CONFIG.kmMaximo) return 'Revisá el kilometraje: parece demasiado alto.';
    return '';
  },
  golpe: () => (valorRadio('tuvo_reparacion') ? '' : 'Elegí Sí o No.'),
  tipoReparacion: () =>
    valorRadio('tuvo_reparacion') !== 'si' || tiposMarcados().length ? '' : 'Marcá si fue mecánica, estética o ambas.',
  detalleReparacion: () =>
    valorRadio('tuvo_reparacion') !== 'si' || textoDe(campos.detalle).length >= 3 ? '' : 'Contanos brevemente qué se reparó.',
  unicaMano: () => (valorRadio('unica_mano') ? '' : 'Elegí Sí o No.'),
  // Contacto: alcanza con uno de los dos datos, pero no se dice. Si faltan ambos, se marcan los dos.
  telefono: () => {
    const telefono = textoDe(campos.telefono);
    if (!telefono) return textoDe(campos.email) ? '' : 'Ingresá tu teléfono.';
    return telefonoValido(telefono) ? '' : 'Revisá el teléfono: incluí el código de área.';
  },
  email: () => {
    const email = textoDe(campos.email);
    if (!email) return textoDe(campos.telefono) ? '' : 'Ingresá tu email.';
    return emailValido(email) ? '' : 'Revisá el email.';
  },
};
const CAMPOS_DE_CONTACTO = ['telefono', 'email'];

const contenedorDe = (clave) => form.querySelector(`[data-campo="${clave}"]`);
const controlesDe = (clave) => $$('input, select, textarea', contenedorDe(clave));
const claveDe = (elemento) => elemento.closest?.('[data-campo]')?.dataset.campo;
const tieneError = (clave) => contenedorDe(clave)?.classList.contains('campo--error');

function mostrarError(clave, mensaje) {
  const contenedor = contenedorDe(clave);
  const salida = $(`#error-${clave}`);
  if (!contenedor || !salida) return;
  contenedor.classList.toggle('campo--error', Boolean(mensaje));
  salida.textContent = mensaje;
  salida.hidden = !mensaje;
  for (const control of controlesDe(clave)) {
    if (mensaje) control.setAttribute('aria-invalid', 'true');
    else control.removeAttribute('aria-invalid');
  }
}

function validarCampo(clave) {
  const mensaje = VALIDADORES[clave]();
  mostrarError(clave, mensaje);
  return !mensaje;
}

const pasoValido = (paso) => CAMPOS_DEL_PASO[paso].every((clave) => !VALIDADORES[clave]());

function validarPaso(paso) {
  const invalidos = CAMPOS_DEL_PASO[paso].filter((clave) => !validarCampo(clave));
  if (!invalidos.length) return true;
  const primero = invalidos[0];
  contenedorDe(primero).scrollIntoView({ block: 'center', behavior: comportamientoScroll() });
  controlesDe(primero)[0]?.focus({ preventScroll: true });
  anunciar(invalidos.length === 1 ? 'Revisá el campo marcado.' : `Revisá los ${invalidos.length} campos marcados.`);
  return false;
}

// Validación en vivo: se corrige apenas el dato es válido; los errores nuevos
// aparecen recién después del primer intento de avanzar ("premiar rápido, castigar tarde").
form.addEventListener('input', (evento) => {
  if (!enviando) idDeEnvio = ''; // cambiaron los datos: si reintentan, es un envío nuevo
  const clave = claveDe(evento.target);
  if (CAMPOS_DE_CONTACTO.includes(clave)) {
    // Teléfono y email dependen uno del otro. Mientras se escribe, los errores solo se limpian
    // (los de formato aparecen al salir del campo o al enviar).
    for (const campo of CAMPOS_DE_CONTACTO) {
      if (tieneError(campo) && !VALIDADORES[campo]()) mostrarError(campo, '');
    }
  } else if (clave && VALIDADORES[clave] && tieneError(clave)) {
    validarCampo(clave);
  }
  guardarBorradorPronto();
});

// Nota: se usa el paso al que pertenece el campo (no el paso visible), porque al usar el
// "atrás" del celular con un campo enfocado, el evento llega cuando ya cambió de pantalla.
form.addEventListener('change', (evento) => {
  const { target } = evento;
  if (!enviando) idDeEnvio = '';
  if (target.name === 'tuvo_reparacion') {
    actualizarDesplegable({ avisar: true });
    for (const clave of ['tipoReparacion', 'detalleReparacion']) if (tieneError(clave)) validarCampo(clave);
  }
  const clave = claveDe(target);
  if (clave && VALIDADORES[clave] && (intentado[pasoDe(target)] || tieneError(clave))) validarCampo(clave);
  guardarBorradorPronto();
});

form.addEventListener('focusout', (evento) => {
  const clave = claveDe(evento.target);
  if (!clave || !VALIDADORES[clave] || !intentado[pasoDe(evento.target)]) return;
  // En grupos (Sí/No, chips) se valida cuando el foco sale del grupo entero.
  if (evento.relatedTarget && contenedorDe(clave).contains(evento.relatedTarget)) return;
  validarCampo(clave);
});

// "Enter" en el celular pasa al campo siguiente en lugar de enviar a medias.
const SIGUIENTE_CON_ENTER = {
  marca: () => campos.modelo,
  modelo: () => (campos.version.disabled ? campos.anio : campos.version),
  version: () => campos.anio,
  kilometraje: () => form.querySelector('input[name="tuvo_reparacion"]'),
  telefono: () => campos.email,
};
// Desde el teléfono, Enter siempre lleva al email (aunque con el teléfono ya alcance para enviar).
const ENTER_SIEMPRE_AVANZA = new Set(['telefono']);
form.addEventListener('keydown', (evento) => {
  if (evento.key !== 'Enter' || evento.defaultPrevented || evento.isComposing) return;
  const siguiente = SIGUIENTE_CON_ENTER[evento.target.id];
  if (!siguiente) return;
  if (!ENTER_SIEMPRE_AVANZA.has(evento.target.id) && pasoValido(pasoActual)) return;
  evento.preventDefault();
  siguiente()?.focus();
});

/** Primer paso anterior a `paso` que todavía está incompleto ('' si se puede llegar a `paso`). */
function primerPasoIncompleto(paso) {
  const hasta = PASOS_DEL_FORMULARIO.indexOf(paso);
  if (hasta <= 0) return '';
  return PASOS_DEL_FORMULARIO.slice(0, hasta).find((anterior) => !pasoValido(anterior)) ?? '';
}

/* ---------- Navegación entre pantallas ---------- */
function irA(destino, { historial = 'push', animar = true, enfocar = true } = {}) {
  let paso = primerPasoIncompleto(destino) || destino;
  if (paso === 'listo' && !enviado) paso = 'intro';
  let modoHistorial = historial;
  if (paso !== destino && modoHistorial === 'ninguno') modoHistorial = 'replace';

  pasoActual = paso;
  document.body.dataset.paso = paso;
  for (const [nombre, panel] of Object.entries(paneles)) {
    panel.hidden = nombre !== paso;
    panel.classList.remove('entrando', 'saliendo');
  }
  const panel = paneles[paso];
  if (animar && !sinAnimaciones()) {
    void panel.offsetWidth; // reinicia la animación de entrada
    panel.classList.add('entrando');
  }

  const indiceActual = Number(window.history.state?.indice) || 0;
  const url = `${window.location.pathname}${window.location.search}${HASH_DE_PASO[paso]}`;
  if (modoHistorial === 'push') window.history.pushState({ paso, indice: indiceActual + 1 }, '', url);
  else if (modoHistorial === 'replace') window.history.replaceState({ paso, indice: indiceActual }, '', url);

  comboMarca.cerrar();
  comboModelo.cerrar();
  comboVersion.cerrar();
  window.scrollTo(0, 0);
  if (enfocar) $('[data-foco]', panel)?.focus({ preventScroll: true });
}

function volver() {
  const previo = PASO_PREVIO[pasoActual];
  if (!previo) return;
  const estado = window.history.state;
  // Si llegamos acá navegando, "Volver" = botón atrás del navegador (historial prolijo).
  if (estado?.paso === pasoActual && Number(estado.indice) > 0) window.history.back();
  else irA(previo, { historial: 'replace' });
}

window.addEventListener('popstate', (evento) => {
  // Un enlace dentro de la portada (por ejemplo "#como-funciona") no es un paso: que el navegador solo desplace.
  if (!evento.state && window.location.hash && !(window.location.hash in PASO_DE_HASH)) return;
  const paso = evento.state?.paso ?? PASO_DE_HASH[window.location.hash] ?? 'intro';
  const indice = Number(evento.state?.indice) || 0;

  if (enviando) {
    // Mientras se envía, nos quedamos en el último paso: se deshace el "atrás".
    if (paso !== 'contacto') window.history.go(1);
    return;
  }

  if (enviado && paso !== 'listo') {
    // Después de enviar, "atrás" arranca de cero y sin dejar entradas viejas en el historial.
    reiniciarFormulario();
    if (indice > 0) window.history.go(-indice);
    else irA('intro', { historial: 'replace' });
    return;
  }

  const pendiente = primerPasoIncompleto(paso);
  if (pendiente && indice > 0) {
    // "Adelante" a un paso con el anterior incompleto: volvemos y mostramos qué falta.
    pasoARevisarAlVolver = pendiente;
    window.history.back();
    return;
  }

  irA(paso, { historial: 'ninguno' });
  if (pasoARevisarAlVolver && pasoActual === pasoARevisarAlVolver) {
    pasoARevisarAlVolver = '';
    intentado[pasoActual] = true;
    validarPaso(pasoActual);
  }
});

// "Quiero vender mi vehículo": el botón de la portada y el del cierre hacen lo mismo.
for (const boton of [$('#btn-empezar'), ...$$('[data-accion="empezar"]')]) boton.addEventListener('click', empezar);
function empezar() {
  if (pasoActual !== 'intro' || saliendoDeIntro) return;
  track('consignacion_inicio');
  if (sinAnimaciones()) {
    irA('vehiculo');
    return;
  }
  saliendoDeIntro = true;
  paneles.intro.classList.add('saliendo');
  window.setTimeout(() => {
    saliendoDeIntro = false;
    irA('vehiculo');
  }, 200);
}

form.addEventListener('click', (evento) => {
  if (evento.target.closest('[data-accion="volver"]')) volver();
});

/* ---------- Avance y envío ---------- */
form.addEventListener('submit', (evento) => {
  evento.preventDefault();
  if (pasoActual === 'vehiculo') continuarAEstado();
  else if (pasoActual === 'estado') continuarAContacto();
  else if (pasoActual === 'contacto') intentarEnviar();
});

function continuarAEstado() {
  intentado.vehiculo = true;
  comboMarca.confirmar();
  comboModelo.confirmar();
  if (!validarPaso('vehiculo')) return;
  track('consignacion_vehiculo', datosParaMedicion());
  irA('estado');
}

function actualizarAvisoSinFotos() {
  const mostrar = avisoSinFotosMostrado && fotos.cantidad() === 0;
  const teniaFoco = nudgeFotos.contains(document.activeElement);
  nudgeFotos.hidden = !mostrar;
  // Si el foco estaba en el aviso (p. ej., en "Agregar fotos"), que no se pierda al ocultarlo.
  if (!mostrar && teniaFoco) btnContinuarEstado.focus();
  if (!preparandoFotos) etiquetaContinuarEstado.textContent = mostrar ? 'Continuar sin fotos' : 'Continuar';
}

$('#nudge-agregar').addEventListener('click', () => fotos.abrirSelector());

/** Espera a que terminen de procesarse las fotos. Devuelve false si alguna no se pudo leer. */
async function fotosListas() {
  if (!fotos.procesando()) return true;
  const antes = fotos.cantidad();
  preparandoFotos = true;
  btnContinuarEstado.setAttribute('aria-disabled', 'true');
  etiquetaContinuarEstado.textContent = 'Preparando fotos…';
  try {
    await fotos.esperar();
  } finally {
    preparandoFotos = false;
    btnContinuarEstado.removeAttribute('aria-disabled');
    actualizarAvisoSinFotos();
  }
  if (fotos.cantidad() >= antes) return true;
  // Alguna foto no se pudo leer: que la persona lo vea (el aviso queda junto a las fotos).
  if (pasoActual !== 'estado') irA('estado');
  $('#campo-fotos').scrollIntoView({ block: 'center', behavior: comportamientoScroll() });
  btnContinuarEstado.focus({ preventScroll: true });
  anunciar('Una de las fotos no se pudo leer. Revisá las fotos y volvé a intentar.');
  return false;
}

async function continuarAContacto() {
  if (preparandoFotos || enviando) return;
  intentado.estado = true;
  if (!validarPaso('estado')) return;
  // Las fotos son opcionales: la primera vez sin fotos, recordamos que ayudan.
  if (fotos.cantidad() === 0 && !avisoSinFotosMostrado) {
    avisoSinFotosMostrado = true;
    actualizarAvisoSinFotos();
    nudgeFotos.scrollIntoView({ block: 'center', behavior: comportamientoScroll() });
    nudgeFotos.focus({ preventScroll: true });
    anunciar('¿Seguís sin fotos? Con fotos evaluamos tu vehículo mucho más rápido. Podés agregarlas o seguir igual.');
    return;
  }
  if (!(await fotosListas())) return;
  track('consignacion_estado', { ...datosParaMedicion(), fotos: fotos.cantidad() });
  irA('contacto');
}

/** Mientras se envía no se puede editar ni dejar el paso: lo enviado es lo que después se muestra. */
function bloquearFormulario(bloquear) {
  for (const paso of PASOS_DEL_FORMULARIO) paneles[paso].inert = bloquear;
  if (bloquear) {
    btnEnviar.setAttribute('aria-disabled', 'true');
    form.setAttribute('aria-busy', 'true');
  } else {
    btnEnviar.removeAttribute('aria-disabled');
    form.removeAttribute('aria-busy');
  }
}

/** Foto de los datos en el momento de enviar: se usa para el envío, el resumen y la medición. */
function tomarInstantanea() {
  const tuvoReparacion = valorRadio('tuvo_reparacion');
  return {
    marca: textoDe(campos.marca),
    modelo: textoDe(campos.modelo),
    version: versionElegida(),
    anio: campos.anio.value,
    kilometraje: leerKm(),
    tuvoReparacion,
    tiposReparacion: tuvoReparacion === 'si' ? tiposMarcados() : [],
    detalleReparacion: tuvoReparacion === 'si' ? campos.detalle.value.trim() : '',
    unicaMano: valorRadio('unica_mano'),
    telefono: textoDe(campos.telefono),
    email: textoDe(campos.email),
    fotos: fotos.archivosConToma(),
  };
}

async function intentarEnviar({ sinFotos = false } = {}) {
  if (enviando || preparandoFotos) return;
  intentado.contacto = true;
  ocultarErrorEnvio();
  if (!validarPaso('contacto')) return;
  const pendiente = primerPasoIncompleto('contacto');
  if (pendiente) {
    irA(pendiente);
    intentado[pendiente] = true;
    validarPaso(pendiente);
    return;
  }
  if (!sinFotos && !(await fotosListas())) return;

  enviando = true;
  bloquearFormulario(true);
  try {
    const instantanea = tomarInstantanea();
    if (sinFotos) instantanea.fotos = [];
    idDeEnvio ||= nuevoIdDeEnvio();
    etiquetaEnviar.textContent = 'Enviando…';
    anunciar('Enviando tus datos…');
    const respuesta = await enviarFormulario(construirDatos(instantanea), (avance) => {
      etiquetaEnviar.textContent = avance < 1 ? `Enviando… ${Math.round(avance * 100)}%` : 'Enviando…';
    });

    enviado = true;
    idDeEnvio = '';
    track('consignacion_lead', {
      marca: instantanea.marca,
      modelo: instantanea.modelo,
      anio: instantanea.anio,
      fotos: instantanea.fotos.length,
      lead_id: respuesta.id,
    });
    bloquearFormulario(false);
    mostrarListo(instantanea);
  } catch (error) {
    bloquearFormulario(false);
    // Si falla la conexión con fotos adjuntas, ofrecemos mandar solo los datos: no perder el lead por un opcional.
    const problemaDeConexion = Boolean(error?.timeout) || !error?.estado || error?.estado === 413;
    mostrarErrorEnvio(mensajeDeError(error), { ofrecerSinFotos: !sinFotos && fotos.cantidad() > 0 && problemaDeConexion });
  } finally {
    enviando = false;
    bloquearFormulario(false);
    etiquetaEnviar.textContent = 'Enviar';
  }
}

function construirDatos(datosVehiculo) {
  const datos = new FormData();
  datos.append('envio_id', idDeEnvio);
  datos.append('marca', datosVehiculo.marca);
  datos.append('modelo', datosVehiculo.modelo);
  datos.append('version', datosVehiculo.version);
  datos.append('version_desconocida', datosVehiculo.version ? 'no' : 'si');
  datos.append('anio', datosVehiculo.anio);
  datos.append('kilometraje', String(datosVehiculo.kilometraje));
  datos.append('tuvo_reparacion', datosVehiculo.tuvoReparacion);
  if (datosVehiculo.tuvoReparacion === 'si') {
    for (const tipo of datosVehiculo.tiposReparacion) datos.append('tipo_reparacion', tipo);
    datos.append('detalle_reparacion', datosVehiculo.detalleReparacion);
  }
  datos.append('unica_mano', datosVehiculo.unicaMano);
  datos.append('telefono', datosVehiculo.telefono);
  datos.append('email', datosVehiculo.email);
  // Cada foto viaja con su toma en el nombre del archivo ("frente.jpg"); el servidor la registra en lead.json.
  datosVehiculo.fotos.forEach(({ toma, blob }) => datos.append('fotos', blob, `${toma}.jpg`));
  for (const [clave, valor] of Object.entries(origen)) {
    if (typeof valor === 'string' && valor) datos.append(clave, valor);
  }
  return datos;
}

function enviarFormulario(datos, alProgresar) {
  return new Promise((resolver, rechazar) => {
    const xhr = new XMLHttpRequest();
    let vigia;
    // Se corta solo si el envío deja de avanzar (no por tardar).
    const rearmar = () => {
      window.clearTimeout(vigia);
      vigia = window.setTimeout(() => {
        xhr.abort();
        rechazar(Object.assign(new Error('El envío dejó de avanzar'), { estado: 0, timeout: true }));
      }, CONFIG.inactividadEnvioMs);
    };
    xhr.open('POST', CONFIG.endpoint);
    xhr.responseType = 'json';
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.addEventListener('progress', (evento) => {
      rearmar();
      if (evento.lengthComputable) alProgresar(evento.loaded / evento.total);
    });
    xhr.addEventListener('readystatechange', rearmar);
    xhr.addEventListener('progress', rearmar);
    xhr.addEventListener('loadend', () => window.clearTimeout(vigia));
    xhr.addEventListener('load', () => {
      const cuerpo = xhr.response && typeof xhr.response === 'object' ? xhr.response : null;
      if (xhr.status >= 200 && xhr.status < 300 && cuerpo?.ok) resolver(cuerpo);
      else rechazar(Object.assign(new Error('Envío rechazado'), { estado: xhr.status, cuerpo }));
    });
    xhr.addEventListener('error', () => rechazar(Object.assign(new Error('Error de red'), { estado: 0 })));
    rearmar();
    xhr.send(datos);
  });
}

function mensajeDeError(error) {
  if (error?.timeout) return 'El envío dejó de avanzar. Revisá tu conexión y volvé a intentar.';
  if (!error?.estado) return 'No pudimos conectarnos. Revisá tu conexión a internet y volvé a intentar.';
  if (error.estado === 413) return 'Las fotos pesan demasiado. Probá quitando alguna y volvé a intentar.';
  if (error.estado === 400 || error.estado === 422) {
    return error.cuerpo?.error || 'Hay datos que no pudimos validar. Revisalos y volvé a intentar.';
  }
  return 'Tuvimos un problema al recibir tus datos. Volvé a intentar en unos minutos.';
}

function mostrarErrorEnvio(mensaje, { ofrecerSinFotos = false } = {}) {
  errorEnvio.hidden = false;
  errorEnvio.replaceChildren();
  errorEnvio.scrollIntoView({ block: 'center', behavior: comportamientoScroll() });
  errorEnvio.focus({ preventScroll: true });
  // Se completa en el siguiente ciclo para que los lectores de pantalla lo anuncien.
  window.setTimeout(() => {
    const texto = document.createElement('p');
    texto.textContent = ofrecerSinFotos ? `${mensaje} También podés mandar solo los datos del vehículo, sin las fotos.` : mensaje;
    errorEnvio.append(texto);
    if (ofrecerSinFotos) {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'btn btn-secundario';
      boton.textContent = 'Enviar sin fotos';
      boton.addEventListener('click', () => intentarEnviar({ sinFotos: true }));
      errorEnvio.append(boton);
    }
  }, 50);
}

function ocultarErrorEnvio() {
  errorEnvio.hidden = true;
  errorEnvio.replaceChildren();
}

/* ---------- Confirmación ---------- */
function mostrarListo(datos) {
  const cantidadFotos = datos.fotos.length;
  $('#listo-vehiculo').textContent = `${datos.marca} ${datos.modelo} ${datos.anio}`;

  const filas = [
    ['Vehículo', `${datos.marca} ${datos.modelo}`],
    ['Versión', datos.version || 'Sin especificar'],
    ['Año', datos.anio],
    ['Kilometraje', `${formatearMiles(datos.kilometraje)} km`],
    [
      'Golpes o reparaciones',
      datos.tuvoReparacion === 'si' ? `Sí (${datos.tiposReparacion.map((tipo) => NOMBRE_TIPO[tipo]).join(' y ')})` : 'No',
    ],
    ['Única mano', datos.unicaMano === 'si' ? 'Sí' : 'No'],
    ['Fotos', cantidadFotos ? `${cantidadFotos} ${cantidadFotos === 1 ? 'foto' : 'fotos'}` : 'Sin fotos'],
    ['Contacto', [datos.telefono, datos.email].filter(Boolean).join(' · ')],
  ];
  $('#resumen').replaceChildren(
    ...filas.map(([termino, valor]) => {
      const fila = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = termino;
      dd.textContent = valor;
      fila.append(dt, dd);
      return fila;
    }),
  );

  borrarBorrador();
  irA('listo', { historial: 'replace' });
}

function reiniciarFormulario() {
  form.reset();
  fotos.limpiar();
  enviado = false;
  avisoSinFotosMostrado = false;
  intentado.vehiculo = false;
  intentado.estado = false;
  intentado.contacto = false;
  marcaConfirmada = '';
  modeloConfirmado = '';
  kmPrevio = '';
  idDeEnvio = '';
  for (const clave of Object.keys(VALIDADORES)) mostrarError(clave, '');
  ocultarErrorEnvio();
  actualizarDesplegable();
  actualizarPlaceholderModelo();
  aplicarVersionDesconocida();
  comboMarca.sincronizar();
  comboModelo.actualizar();
  actualizarAvisoSinFotos();
  borrarBorrador();
}

$('#btn-otro').addEventListener('click', () => {
  reiniciarFormulario();
  irA('vehiculo');
});

/* ---------- Borrador (si se recarga la página no se pierden los datos) ---------- */
let temporizadorBorrador;

function leerBorrador() {
  try {
    const datos = JSON.parse(window.sessionStorage.getItem(CLAVE_BORRADOR) || 'null');
    return datos && typeof datos === 'object' ? datos : null;
  } catch {
    return null;
  }
}

function guardarBorrador() {
  window.clearTimeout(temporizadorBorrador);
  if (enviado) return;
  const datos = {
    marca: campos.marca.value,
    modelo: campos.modelo.value,
    version: campos.version.value,
    version_desconocida: campos.versionDesconocida.checked,
    anio: campos.anio.value,
    kilometraje: campos.kilometraje.value,
    tuvo_reparacion: valorRadio('tuvo_reparacion'),
    tipo_reparacion: tiposMarcados(),
    detalle_reparacion: campos.detalle.value,
    unica_mano: valorRadio('unica_mano'),
    telefono: campos.telefono.value,
    email: campos.email.value,
    // Las fotos no se pueden guardar; solo cuántas había, para avisar si se pierden al recargar.
    fotos: fotos.cantidad(),
  };
  try {
    window.sessionStorage.setItem(CLAVE_BORRADOR, JSON.stringify(datos));
  } catch {
    /* modo privado o almacenamiento lleno: seguimos sin borrador */
  }
}

function guardarBorradorPronto() {
  window.clearTimeout(temporizadorBorrador);
  temporizadorBorrador = window.setTimeout(guardarBorrador, 300);
}

function borrarBorrador() {
  window.clearTimeout(temporizadorBorrador);
  try {
    window.sessionStorage.removeItem(CLAVE_BORRADOR);
  } catch {
    /* nada que borrar */
  }
}

function restaurarBorrador(datos) {
  if (!datos) return;
  const cadena = (valor, maximo) => (typeof valor === 'string' ? valor.slice(0, maximo) : '');
  campos.marca.value = cadena(datos.marca, 60);
  campos.modelo.value = cadena(datos.modelo, 60);
  campos.version.value = cadena(datos.version, 80);
  campos.versionDesconocida.checked = datos.version_desconocida === true;
  const anio = cadena(datos.anio, 4);
  if (anio && Array.from(campos.anio.options).some((opcion) => opcion.value === anio)) campos.anio.value = anio;
  campos.kilometraje.value = cadena(datos.kilometraje, 12);
  formatearKm();
  marcarRadio('tuvo_reparacion', cadena(datos.tuvo_reparacion, 2));
  marcarRadio('unica_mano', cadena(datos.unica_mano, 2));
  const tipos = Array.isArray(datos.tipo_reparacion) ? datos.tipo_reparacion : [];
  for (const casilla of $$('input[name="tipo_reparacion"]', form)) casilla.checked = tipos.includes(casilla.value);
  campos.detalle.value = cadena(datos.detalle_reparacion, 1000);
  campos.telefono.value = cadena(datos.telefono, 25);
  campos.email.value = cadena(datos.email, 120);
  marcaConfirmada = textoDe(campos.marca);
  modeloConfirmado = textoDe(campos.modelo);
  // Típico en Android: al volver de la cámara el navegador recarga la pestaña y las fotos se pierden.
  if (Number(datos.fotos) > 0) {
    fotos.avisar(
      'Se recargó la página y se perdieron las fotos que habías cargado. Volvé a agregarlas (si te pasa al usar la cámara, sacalas antes y elegilas desde la galería).',
      true,
    );
  }
}

/* ---------- Inicio ---------- */
function iniciar() {
  $('#anio-pie').textContent = String(new Date().getFullYear());
  poblarAnios();
  restaurarBorrador(leerBorrador());
  actualizarDesplegable();
  actualizarPlaceholderModelo();
  aplicarVersionDesconocida();
  comboMarca.sincronizar();
  comboModelo.actualizar();
  cargarVersiones(campos.marca.value);

  // Si recargan a mitad de camino, retoman en el mismo paso.
  const pedido = PASO_DE_HASH[window.location.hash];
  const inicial = PASOS_DEL_FORMULARIO.includes(pedido) ? primerPasoIncompleto(pedido) || pedido : 'intro';
  irA(inicial, { historial: 'replace', animar: false, enfocar: false });

  window.addEventListener('pagehide', guardarBorrador);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') guardarBorrador();
  });
}

iniciar();
