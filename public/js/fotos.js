/* =========================================================================
   Gestor de fotos por toma: 8 casillas con nombre (frente, trasera,
   laterales, interior, tablero, motor y baúl). Cada casilla carga su foto;
   si eligen varias juntas, llenan las casillas libres en orden. Cada foto
   viaja con el nombre de su toma.
   Las fotos se comprimen en el navegador antes de subirlas (lado máximo
   1600 px, JPEG). Al re-codificarlas también se descartan los metadatos
   EXIF, incluida la ubicación GPS de la foto.
   ========================================================================= */

const LADO_MAXIMO = 1600;
const CALIDAD_JPEG = 0.82;
const PESO_MAXIMO_ORIGINAL = 40 * 1024 * 1024;
const EXTENSIONES_IMAGEN = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i;

/** Tomas sugeridas, en el orden en que se muestran. La clave viaja al servidor (sin acentos). */
export const TOMAS = [
  { clave: 'frente', nombre: 'Frente', de: 'del frente' },
  { clave: 'trasera', nombre: 'Trasera', de: 'de la trasera' },
  { clave: 'lateral-izquierdo', nombre: 'Lateral izquierdo', de: 'del lateral izquierdo' },
  { clave: 'lateral-derecho', nombre: 'Lateral derecho', de: 'del lateral derecho' },
  { clave: 'interior', nombre: 'Interior', de: 'del interior' },
  { clave: 'tablero', nombre: 'Tablero', de: 'del tablero' },
  { clave: 'motor', nombre: 'Motor', de: 'del motor' },
  { clave: 'baul', nombre: 'Baúl', de: 'del baúl' },
];

const ICONO_AGREGAR =
  '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 8.5a2 2 0 0 1 2-2h1.8l1.5-2h6.4l1.5 2h1.8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M12 10.5v5M9.5 13h5"/></svg>';
const ICONO_OK = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l3.8 3.8L18 8"/></svg>';
const ICONO_QUITAR = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';

const esImagen = (archivo) => archivo.type.startsWith('image/') || (!archivo.type && EXTENSIONES_IMAGEN.test(archivo.name));
const recortar = (nombre, largo = 28) => (nombre.length > largo ? `${nombre.slice(0, largo - 1)}…` : nombre);
const tieneArchivos = (evento) => Array.from(evento.dataTransfer?.types ?? []).includes('Files');

/** Decodifica la imagen, la achica y la re-codifica como JPEG. */
async function comprimir(archivo) {
  const url = URL.createObjectURL(archivo);
  try {
    const imagen = new Image();
    imagen.decoding = 'async';
    imagen.src = url;
    await imagen.decode();
    const ancho = imagen.naturalWidth;
    const alto = imagen.naturalHeight;
    if (!ancho || !alto) throw new Error('Imagen vacía');

    const escala = Math.min(1, LADO_MAXIMO / Math.max(ancho, alto));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(ancho * escala));
    canvas.height = Math.max(1, Math.round(alto * escala));
    const contexto = canvas.getContext('2d', { alpha: false });
    if (!contexto) throw new Error('Sin canvas');
    contexto.imageSmoothingEnabled = true;
    contexto.imageSmoothingQuality = 'high';
    contexto.drawImage(imagen, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolver) => canvas.toBlob(resolver, 'image/jpeg', CALIDAD_JPEG));
    canvas.width = 0; // libera memoria (importante en iPhone)
    canvas.height = 0;
    if (!blob) throw new Error('No se pudo comprimir');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function crearGestorFotos({ zona, grid, input, boton, contador, aviso, tomas = TOMAS, anunciar = () => {}, alCambiar = () => {} }) {
  const maximo = tomas.length;
  /** @type {{ toma: typeof TOMAS[number], estado: 'vacia' | 'procesando' | 'lista', blob?: Blob, url?: string, trabajo?: { cancelada: boolean }, nodo: HTMLLIElement, pintado?: string }[]} */
  const casillas = tomas.map((toma, indice) => {
    const nodo = document.createElement('li');
    nodo.className = 'toma';
    nodo.dataset.toma = toma.clave;
    nodo.dataset.indice = String(indice);
    return { toma, estado: 'vacia', nodo };
  });
  grid.replaceChildren(...casillas.map((casilla) => casilla.nodo));

  let cola = Promise.resolve();
  let destino = null; // casilla que abrió el selector de archivos (null: llenar en orden)
  let fallidas = 0; // fotos que no se pudieron leer

  const cantidad = () => casillas.filter((casilla) => casilla.estado !== 'vacia').length;

  function mostrarAviso(mensaje, esError = false) {
    aviso.textContent = mensaje;
    aviso.classList.toggle('es-error', Boolean(mensaje) && esError);
  }

  /** Casillas libres: primero la que se tocó (si está libre) y después las demás en orden. */
  function libres(desde) {
    const vacias = casillas.map((_, i) => i).filter((i) => casillas[i].estado === 'vacia');
    if (desde === null || !vacias.includes(desde)) return vacias;
    return [desde, ...vacias.filter((i) => i !== desde)];
  }

  function agregar(listaArchivos, desde = null) {
    const archivos = Array.from(listaArchivos ?? []);
    if (!archivos.length) return;

    const lugares = libres(desde);
    if (!lugares.length) {
      const mensaje = `Ya llegaste al máximo de ${maximo} fotos. Quitá alguna para sumar otra.`;
      mostrarAviso(mensaje);
      anunciar(mensaje);
      return;
    }

    // Los rechazos (no es imagen, muy pesada) son errores; el tope de 8 es solo un aviso.
    const problemas = [];
    const validos = [];
    for (const archivo of archivos) {
      if (!esImagen(archivo)) problemas.push(`«${recortar(archivo.name)}» no es una imagen.`);
      else if (archivo.size > PESO_MAXIMO_ORIGINAL) problemas.push(`«${recortar(archivo.name)}» es demasiado pesada.`);
      else validos.push(archivo);
    }
    const huboRechazos = problemas.length > 0;
    const aceptados = validos.slice(0, lugares.length);
    if (validos.length > lugares.length) {
      problemas.push(`Podés subir hasta ${maximo} fotos: sumamos ${aceptados.length === 1 ? 'la primera' : `las primeras ${aceptados.length}`}.`);
    }

    const ubicadas = [];
    aceptados.forEach((archivo, i) => {
      const casilla = casillas[lugares[i]];
      const trabajo = { cancelada: false };
      casilla.estado = 'procesando';
      casilla.trabajo = trabajo;
      ubicadas.push(casilla.toma.nombre.toLowerCase());
      cola = cola.then(() => procesar(casilla, trabajo, archivo)).catch(() => {});
    });

    mostrarAviso(problemas.join(' '), huboRechazos);
    render();
    // Para lectores de pantalla: lo que se agregó (y en qué toma) y lo que no, en un solo anuncio.
    const partes = [];
    if (aceptados.length) {
      const donde = ubicadas.length === 1 ? ` en ${ubicadas[0]}` : '';
      partes.push(`${aceptados.length === 1 ? 'Agregamos 1 foto' : `Agregamos ${aceptados.length} fotos`}${donde}. Tenés ${cantidad()} de ${maximo}.`);
    }
    partes.push(...problemas);
    if (partes.length) anunciar(partes.join(' '));
    alCambiar();
  }

  async function procesar(casilla, trabajo, archivo) {
    if (trabajo.cancelada) return;
    try {
      const blob = await comprimir(archivo);
      if (trabajo.cancelada) return;
      casilla.blob = blob;
      casilla.url = URL.createObjectURL(blob);
      casilla.estado = 'lista';
      casilla.trabajo = undefined;
    } catch {
      if (trabajo.cancelada) return;
      fallidas += 1;
      casilla.estado = 'vacia';
      casilla.trabajo = undefined;
      mostrarAviso(`No pudimos leer «${recortar(archivo.name)}». Probá con otra foto (JPG o PNG).`, true);
      anunciar(`No pudimos leer «${recortar(archivo.name)}». Tenés ${cantidad()} de ${maximo} fotos.`);
    }
    render();
    alCambiar();
  }

  function vaciar(casilla) {
    if (casilla.trabajo) casilla.trabajo.cancelada = true;
    if (casilla.url) URL.revokeObjectURL(casilla.url);
    casilla.estado = 'vacia';
    casilla.blob = undefined;
    casilla.url = undefined;
    casilla.trabajo = undefined;
  }

  function quitar(indice) {
    const casilla = casillas[indice];
    if (!casilla || casilla.estado === 'vacia') return;
    vaciar(casilla);
    mostrarAviso('');
    render();
    casilla.nodo.querySelector('.toma-agregar')?.focus();
    anunciar(`Foto quitada. Tenés ${cantidad()} de ${maximo}.`);
    alCambiar();
  }

  function botonQuitar(casilla) {
    const quitarBoton = document.createElement('button');
    quitarBoton.type = 'button';
    quitarBoton.className = 'foto-quitar';
    quitarBoton.innerHTML = ICONO_QUITAR;
    quitarBoton.setAttribute(
      'aria-label',
      casilla.estado === 'procesando' ? `Cancelar foto ${casilla.toma.de} (procesando)` : `Quitar foto ${casilla.toma.de}`,
    );
    return quitarBoton;
  }

  function pintar(casilla) {
    const { nodo, toma } = casilla;
    const huella = `${casilla.estado}:${casilla.url ?? ''}`;
    if (casilla.pintado === huella) return;
    casilla.pintado = huella;

    const teniaFoco = nodo.contains(document.activeElement);
    const nombre = document.createElement('span');
    nombre.className = 'toma-nombre';
    nombre.textContent = toma.nombre;

    nodo.className = 'toma';
    if (casilla.estado === 'vacia') {
      delete nodo.dataset.estado;
      const agregarBoton = document.createElement('button');
      agregarBoton.type = 'button';
      agregarBoton.className = 'toma-marco toma-agregar';
      agregarBoton.setAttribute('aria-label', `Agregar foto ${toma.de}`);
      agregarBoton.innerHTML = ICONO_AGREGAR;
      nodo.replaceChildren(agregarBoton, nombre);
    } else {
      nodo.classList.add('foto');
      nodo.dataset.estado = casilla.estado;
      const marco = document.createElement('div');
      marco.className = 'toma-marco';
      if (casilla.estado === 'procesando') {
        nodo.classList.add('foto--cargando');
        const spinner = document.createElement('span');
        spinner.className = 'spinner';
        spinner.setAttribute('aria-hidden', 'true');
        marco.append(spinner);
      } else {
        const imagen = document.createElement('img');
        imagen.src = casilla.url;
        imagen.alt = `Foto ${toma.de}`;
        imagen.decoding = 'async';
        imagen.draggable = false;
        const ok = document.createElement('span');
        ok.className = 'toma-ok';
        ok.setAttribute('aria-hidden', 'true');
        ok.innerHTML = ICONO_OK;
        marco.append(imagen, ok);
      }
      nodo.replaceChildren(marco, botonQuitar(casilla), nombre);
    }
    if (teniaFoco) (nodo.querySelector('.foto-quitar') ?? nodo.querySelector('.toma-agregar'))?.focus();
  }

  function render() {
    casillas.forEach(pintar);
    const n = cantidad();
    const lleno = n >= maximo;
    if (lleno && boton.contains(document.activeElement)) {
      casillas[casillas.length - 1].nodo.querySelector('.foto-quitar')?.focus();
    }
    boton.hidden = lleno;
    grid.classList.toggle('vacio', n === 0);
    const numero = document.createElement('b');
    numero.textContent = String(n);
    contador.replaceChildren(numero, ` de ${maximo}`);
  }

  // ---------- Eventos ----------
  grid.addEventListener('click', (evento) => {
    const casilla = evento.target.closest('.toma');
    if (!casilla) return;
    const indice = Number(casilla.dataset.indice);
    if (evento.target.closest('.foto-quitar')) {
      quitar(indice);
      return;
    }
    // En una casilla libre, tocar el nombre de la toma también la carga.
    const libre = !casilla.classList.contains('foto');
    if (evento.target.closest('.toma-agregar') || (libre && evento.target.closest('.toma-nombre'))) {
      destino = indice;
      input.click();
    }
  });
  boton.addEventListener('click', () => {
    destino = null;
    input.click();
  });
  input.addEventListener('change', () => {
    agregar(input.files, destino);
    destino = null;
    input.value = '';
  });

  // Arrastrar y soltar (escritorio): sobre una casilla libre empieza por esa.
  zona.addEventListener('dragenter', (evento) => {
    if (!tieneArchivos(evento)) return;
    evento.preventDefault();
    zona.classList.add('arrastrando');
  });
  zona.addEventListener('dragover', (evento) => {
    if (!tieneArchivos(evento)) return;
    evento.preventDefault();
    evento.dataTransfer.dropEffect = 'copy';
  });
  zona.addEventListener('dragleave', (evento) => {
    if (!zona.contains(evento.relatedTarget)) zona.classList.remove('arrastrando');
  });
  zona.addEventListener('drop', (evento) => {
    if (!tieneArchivos(evento)) return;
    evento.preventDefault();
    zona.classList.remove('arrastrando');
    const sobre = evento.target.closest?.('.toma');
    agregar(evento.dataTransfer.files, sobre ? Number(sobre.dataset.indice) : null);
  });
  // Si sueltan una foto fuera de la zona, que el navegador no la abra y se pierda el formulario.
  window.addEventListener('dragover', (evento) => {
    if (!tieneArchivos(evento) || zona.contains(evento.target)) return;
    evento.preventDefault();
    evento.dataTransfer.dropEffect = 'none';
  });
  window.addEventListener('drop', (evento) => {
    if (tieneArchivos(evento) && !zona.contains(evento.target)) evento.preventDefault();
  });

  render();

  return {
    /** Abre el selector para sumar varias fotos: llenan las casillas libres en orden. */
    abrirSelector: () => {
      destino = null;
      input.click();
    },
    /** Muestra un aviso junto a las fotos (p. ej., si se perdieron al recargar la página). */
    avisar: (mensaje, esError = false) => mostrarAviso(mensaje, esError),
    cantidad,
    /** Fotos que no se pudieron leer desde que se abrió la página (para saber si falló alguna al esperar). */
    fallidas: () => fallidas,
    procesando: () => casillas.some((casilla) => casilla.estado === 'procesando'),
    /** Espera a que terminen de procesarse todas las fotos en cola. */
    async esperar() {
      let actual;
      do {
        actual = cola;
        await actual;
      } while (actual !== cola);
    },
    /** Fotos listas, en el orden de las casillas. */
    archivos: () => casillas.filter((casilla) => casilla.estado === 'lista').map((casilla) => casilla.blob),
    /** Fotos listas con su toma: [{ toma: 'frente', nombre: 'Frente', blob }]. */
    archivosConToma: () =>
      casillas
        .filter((casilla) => casilla.estado === 'lista')
        .map((casilla) => ({ toma: casilla.toma.clave, nombre: casilla.toma.nombre, blob: casilla.blob })),
    limpiar() {
      casillas.forEach(vaciar);
      mostrarAviso('');
      render();
    },
  };
}
