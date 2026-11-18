/* =========================================================================
   Catálogo de marcas con logos (campo "Marca" del paso 1).
   Patrón ARIA 1.2 de combobox con un listbox dibujado en grilla: el foco
   queda siempre en el input y la opción activa se anuncia con
   aria-activedescendant. Mantiene el mismo contrato que combobox.js
   (confirmar al elegir, con Enter, con Tab o al salir del campo, y el evento
   "change" para el borrador), así que app.js no cambia su lógica.
   - Con mouse: al pasar por un logo aparece el nombre; un clic lo elige.
   - Con el dedo: un toque lo elige (el nombre se ve un instante en la tarjeta, en azul).
   - En el celular, tocar el campo despliega el catálogo sin abrir el
     teclado; "Escribir la marca", tocar otra vez el campo u "Otra marca"
     abren el teclado para escribir.
   - Teclado: las flechas recorren las marcas de a una, en orden de lectura.
   - Escribir filtra los logos (sin importar espacios, guiones ni tildes:
     "mercedes benz", "landrover", "GWM") y se puede dejar una marca que no está.
   ========================================================================= */

import { normalizar } from './combobox.js';

const ICONO_CHECK = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>';
const ICONO_LAPIZ =
  '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>';

/** Otras formas de escribir una marca (la clave va sin espacios ni guiones). */
const ALIAS = new Map([
  ['gwm', 'Great Wall'],
  ['vw', 'Volkswagen'],
  ['mercedes', 'Mercedes-Benz'],
  ['alfa', 'Alfa Romeo'],
]);

/** Nombres largos (9 letras o más): dónde cortan con guion si en la tarjeta no entran en una línea. */
const CORTES = new Map([
  ['Volkswagen', 'Volks­wagen'],
  ['Chevrolet', 'Chevro­let'],
  ['Mitsubishi', 'Mitsu­bishi'],
  ['SsangYong', 'Ssang­Yong'],
]);

/** Compara sin tildes, mayúsculas, espacios ni guiones ("Mercedes Benz" = "Mercedes-Benz"). */
const clave = (texto) => normalizar(texto).replace(/[^a-z0-9]/g, '');

/**
 * @param {object} cfg
 * @param {HTMLInputElement} cfg.input       campo de texto de la marca
 * @param {HTMLButtonElement} cfg.boton      flecha que despliega y pliega el catálogo
 * @param {HTMLElement} cfg.catalogo         contenedor que se despliega (.catalogo)
 * @param {HTMLElement} cfg.lista            listbox donde se dibujan las marcas (debe tener id)
 * @param {HTMLElement} cfg.vacio            aviso cuando lo escrito no coincide con ninguna marca
 * @param {HTMLElement} cfg.logoCampo        lugar del logo dentro del campo (.combo-logo)
 * @param {string[]} cfg.marcas              marcas del catálogo, en orden alfabético
 * @param {string[]} cfg.comunes             marcas que van primero
 * @param {Map<string, number>} cfg.logos    slug → ancho del logo (% de la tarjeta)
 * @param {(marca: string) => string} cfg.slug
 * @param {(valor: string) => void} [cfg.alConfirmar]  se llama al confirmar un valor (como en combobox.js)
 * @param {(marca: string) => void} [cfg.alElegir]     se llama después de elegir una marca de la lista
 * @param {(mensaje: string) => void} [cfg.anunciar]   región viva para lectores de pantalla
 */
export function crearCatalogoMarcas({
  input,
  boton,
  catalogo,
  lista,
  vacio,
  logoCampo,
  marcas,
  comunes,
  logos,
  slug,
  alConfirmar = () => {},
  alElegir = () => {},
  anunciar = () => {},
}) {
  const combo = input.closest('.combo');
  const desplazable = catalogo.querySelector('.catalogo-scroll');
  // El <img> del logo dentro del campo se crea acá: en el HTML no hay una imagen sin src.
  const logoImg = logoCampo.querySelector('img') ?? logoCampo.appendChild(Object.assign(document.createElement('img'), { alt: '', width: 40, height: 24, decoding: 'async' }));
  const punteroGrueso = window.matchMedia('(pointer: coarse)');
  const sinMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)');
  const PLACEHOLDER_ESCRIBIR = 'Escribí la marca';
  const placeholderBase = () => (punteroGrueso.matches ? 'Elegí la marca' : 'Elegí o escribí la marca');

  let abierto = false;
  let activa = null;
  let activaAuto = false; // la opción activa la propuso el filtro (no la eligió la persona con las flechas)

  let escribiendo = false;
  let ignorarBlur = false;
  let toquesEnCampo = 0; // activaciones del campo con el catálogo abierto (la segunda abre el teclado)
  let timerEntrada = 0;
  let timerCierre = 0;
  let cierrePendiente = false;
  let timerPlegar = 0;
  let punteroApretado = false;

  // ---------- Construcción del listbox ----------
  const idBase = lista.id;
  // El logo de Great Wall dice "GWM": el nombre accesible incluye lo que se ve.
  const etiquetaDe = (marca) => (marca === 'Great Wall' ? 'Great Wall (GWM)' : marca);
  const crearOpcion = (marca, grupo, indice) => {
    const s = slug(marca);
    const ancho = logos.get(s);
    const op = document.createElement('div');
    op.className = ancho ? 'marca pendiente' : 'marca marca--texto';
    op.id = `${idBase}-${grupo}-${s}`;
    op.setAttribute('role', 'option');
    op.setAttribute('aria-selected', 'false');
    op.setAttribute('aria-label', etiquetaDe(marca));
    op.dataset.marca = marca;
    op.style.setProperty('--i', String(indice));
    if (ancho) {
      const img = document.createElement('img');
      img.className = 'marca-imagen';
      img.alt = '';
      // loading va antes que src: WebKit decide si difiere la carga en el momento en que se asigna el src.
      img.loading = 'lazy';
      img.decoding = 'async';
      img.draggable = false;
      img.style.setProperty('--w', String(ancho));
      // Mientras el logo no llega se ve el nombre; si no llega nunca, la tarjeta queda con el nombre escrito.
      img.addEventListener('load', () => op.classList.remove('pendiente'), { once: true });
      img.addEventListener(
        'error',
        () => {
          img.remove();
          op.classList.replace('pendiente', 'marca--texto');
          programarAjuste();
        },
        { once: true },
      );
      img.src = `img/marcas/${s}.webp`;
      op.append(img);
    }
    const nombre = document.createElement('span');
    nombre.className = 'marca-nombre';
    nombre.textContent = CORTES.get(marca) ?? marca;
    const check = document.createElement('span');
    check.className = 'marca-check';
    check.setAttribute('aria-hidden', 'true');
    check.innerHTML = ICONO_CHECK;
    op.append(nombre, check);
    return op;
  };

  const crearGrupo = (clase, id, titulo, opciones) => {
    const grupo = document.createElement('div');
    grupo.className = `grupo ${clase}`;
    grupo.setAttribute('role', 'group');
    grupo.setAttribute('aria-labelledby', id);
    const t = document.createElement('div');
    t.className = 'grupo-titulo';
    t.id = id;
    t.setAttribute('role', 'presentation');
    t.textContent = titulo;
    const grilla = document.createElement('div');
    grilla.className = 'grilla';
    grilla.append(...opciones);
    grupo.append(t, grilla);
    return grupo;
  };

  const otra = document.createElement('div');
  otra.className = 'marca marca--otra';
  otra.id = `${idBase}-otra`;
  otra.setAttribute('role', 'option');
  otra.setAttribute('aria-selected', 'false');
  otra.dataset.otra = '1';
  otra.style.setProperty('--i', String(comunes.length + marcas.length));
  otra.innerHTML = `${ICONO_LAPIZ}<span class="marca-nombre">Otra marca</span>`;

  const grupoComunes = crearGrupo(
    'grupo-comunes',
    `${idBase}-g1`,
    'Las más comunes',
    comunes.map((marca, i) => crearOpcion(marca, 'c', i)),
  );
  const grupoTodas = crearGrupo('grupo-todas', `${idBase}-g2`, 'Todas las marcas', [
    ...marcas.map((marca, i) => crearOpcion(marca, 't', comunes.length + i)),
    otra,
  ]);
  const tituloTodas = grupoTodas.querySelector('.grupo-titulo');
  lista.replaceChildren(grupoComunes, grupoTodas);

  // En pantallas táctiles, una salida a la vista para escribir la marca (también para lectores de pantalla).
  const botonEscribir = document.createElement('button');
  botonEscribir.type = 'button';
  botonEscribir.className = 'catalogo-escribir';
  botonEscribir.innerHTML = `${ICONO_LAPIZ}<span>Escribir la marca</span>`;
  desplazable.prepend(botonEscribir);

  const opciones = [...lista.querySelectorAll('.marca')];
  const opcionesTodas = [...grupoTodas.querySelectorAll('.marca')];
  const textosVacio = [...vacio.querySelectorAll('.vacio-texto')];

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', lista.id);
  boton.setAttribute('aria-controls', lista.id);
  boton.setAttribute('aria-expanded', 'false');

  function aplicarModoPuntero() {
    input.placeholder = escribiendo ? PLACEHOLDER_ESCRIBIR : placeholderBase();
    // En pantallas táctiles el catálogo se despliega sin teclado; se escribe a pedido.
    const sinTeclado = punteroGrueso.matches && !escribiendo;
    if (sinTeclado) input.setAttribute('inputmode', 'none');
    else input.removeAttribute('inputmode');
    catalogo.classList.toggle('sin-teclado', sinTeclado);
  }

  // ---------- Estado ----------
  const marcaExacta = (valor) => {
    const k = clave(valor);
    if (!k) return undefined;
    const alias = ALIAS.get(k);
    if (alias && marcas.includes(alias)) return alias;
    return marcas.find((marca) => clave(marca) === k);
  };

  /** Refleja en el catálogo y en el campo la marca escrita (tilde azul y logo). */
  function sincronizar() {
    const marca = marcaExacta(input.value);
    for (const op of opciones) op.setAttribute('aria-selected', String(Boolean(marca) && op.dataset.marca === marca));
    const ancho = marca ? logos.get(slug(marca)) : undefined;
    if (ancho) {
      const src = `img/marcas/${slug(marca)}.webp`;
      if (logoImg.getAttribute('src') !== src) logoImg.src = src;
      logoCampo.hidden = false;
      combo.classList.add('con-logo');
    } else {
      logoCampo.hidden = true;
      combo.classList.remove('con-logo');
    }
  }

  function activar(op, { desplazar = true, auto = false } = {}) {
    activa?.classList.remove('activa');
    activa = op;
    activaAuto = Boolean(op) && auto;
    if (op) {
      op.classList.add('activa');
      input.setAttribute('aria-activedescendant', op.id);
      if (desplazar) mostrar(op);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  /** Desplaza solo lo necesario para que la opción activa se vea entera (y fuera del fundido de abajo). */
  function mostrar(op) {
    const r = op.getBoundingClientRect();
    const interno = desplazable.scrollHeight > desplazable.clientHeight + 1;
    if (interno) {
      const c = desplazable.getBoundingClientRect();
      if (r.top < c.top + 8) desplazable.scrollTop -= c.top + 8 - r.top;
      else if (r.bottom > c.bottom - 30) desplazable.scrollTop += r.bottom - c.bottom + 30;
      return;
    }
    const vv = window.visualViewport;
    const arriba = (vv?.offsetTop ?? 0) + 12;
    const abajo = (vv ? vv.offsetTop + vv.height : window.innerHeight) - 12;
    if (r.top < arriba) window.scrollBy({ top: r.top - arriba });
    else if (r.bottom > abajo) window.scrollBy({ top: r.bottom - abajo });
  }

  const visibles = () => opciones.filter((op) => !op.hidden && !op.closest('.grupo').hidden);

  /**
   * Filtra por lo escrito. Orden: exacta, empieza con, palabra que empieza con, contiene y,
   * por último, sin espacios ni guiones ("landrover"). Con `auto`, deja propuesta la mejor
   * coincidencia solo si es exacta o empieza igual ("toy" → Toyota; "Rover" no propone Land Rover).
   */
  function filtrar(texto, { auto = false } = {}) {
    const n = normalizar(texto);
    const k = clave(texto);
    const alias = ALIAS.get(k);
    const prefijoAlias = (marca) => k.length >= 2 && [...ALIAS].some(([a, m]) => m === marca && a.startsWith(k));
    const rango = (marca) => {
      const nombre = normalizar(marca);
      const c = clave(marca);
      if (nombre === n || (k && c === k) || marca === alias) return 0;
      if (nombre.startsWith(n) || (k && c.startsWith(k)) || prefijoAlias(marca)) return 1;
      if (nombre.split(/[\s-]+/).some((p) => p.startsWith(n))) return 2;
      if (nombre.includes(n)) return 3;
      if (k && c.includes(k)) return 4;
      return 9;
    };
    catalogo.classList.toggle('filtrando', Boolean(n));
    grupoComunes.hidden = Boolean(n);
    tituloTodas.hidden = Boolean(n);
    let mejor = null;
    let mejorRango = 9;
    let hay = 0;
    for (const op of opcionesTodas) {
      if (op.dataset.otra) {
        op.hidden = Boolean(n);
        continue;
      }
      const r = n ? rango(op.dataset.marca) : 0;
      op.hidden = r === 9;
      if (r !== 9) hay++;
      if (n && r < mejorRango) {
        mejor = op;
        mejorRango = r;
      }
    }
    const sinResultados = Boolean(n) && hay === 0;
    const limpio = texto.replace(/\s+/g, ' ').trim();
    vacio.hidden = !sinResultados;
    for (const s of textosVacio) s.textContent = limpio;
    if (auto && sinResultados) anunciar(`No encontramos «${limpio}» en la lista. Podés dejarla escrita así.`);
    if (auto && mejor && mejorRango <= 1) activar(mejor, { auto: true });
    else activar(null);
  }

  function abrir({ animar = true } = {}) {
    if (input.disabled) return;
    clearTimeout(timerCierre);
    clearTimeout(timerPlegar);
    cierrePendiente = false;
    if (abierto) return;
    abierto = true;
    // Al desplegar no se propone nada. Sin teclado (celular), se ven todas las marcas aunque haya texto escrito.
    const sinTeclado = punteroGrueso.matches && !escribiendo;
    filtrar(marcaExacta(input.value) || sinTeclado ? '' : input.value);
    clearTimeout(timerEntrada);
    if (animar && !sinMovimiento.matches) {
      catalogo.classList.add('entrando');
      timerEntrada = window.setTimeout(() => catalogo.classList.remove('entrando'), 1100);
    }
    catalogo.classList.add('abierto');
    combo.setAttribute('data-abierto', '');
    input.setAttribute('aria-expanded', 'true');
    boton.setAttribute('aria-expanded', 'true');
    desplazable.scrollTop = 0;
    precargarLogos();
    llevarCampoArriba();
  }

  function cerrar() {
    clearTimeout(timerCierre);
    clearTimeout(timerPlegar);
    cierrePendiente = false;
    toquesEnCampo = 0;
    for (const op of lista.querySelectorAll('.confirmando')) op.classList.remove('confirmando');
    if (!abierto) return;
    abierto = false;
    catalogo.classList.remove('abierto', 'entrando', 'filtrando');
    combo.removeAttribute('data-abierto');
    input.setAttribute('aria-expanded', 'false');
    boton.setAttribute('aria-expanded', 'false');
    activar(null);
  }

  /** En el celular, al desplegar, el campo sube para que entren los logos en pantalla. */
  function llevarCampoArriba() {
    if (!window.matchMedia('(max-width: 639px)').matches) return;
    window.setTimeout(() => {
      if (!abierto) return;
      const r = combo.getBoundingClientRect();
      const vv = window.visualViewport;
      const alto = vv ? vv.height : window.innerHeight;
      if (r.top > alto * 0.5) {
        window.scrollBy({ top: r.top - 12, behavior: sinMovimiento.matches ? 'auto' : 'smooth' });
      }
    }, 60);
  }

  /** Limpia espacios y, si coincide con una marca conocida, usa su escritura oficial. */
  function confirmar() {
    const limpio = input.value.replace(/\s+/g, ' ').trim();
    const final = marcaExacta(limpio) ?? limpio;
    if (final !== input.value) input.value = final;
    sincronizar();
    alConfirmar(final);
  }

  /** Vuelve el campo a su modo de elegir (en el celular, sin teclado hasta que lo pidan). */
  function volverAElegir() {
    escribiendo = false;
    aplicarModoPuntero();
  }

  /**
   * Elige una marca. Con un clic o un toque, la tarjeta se marca en azul un instante antes de
   * plegar el catálogo; con el teclado se pliega en el acto (el campo de abajo no se mueve).
   */
  function elegir(op, { conPuntero = false } = {}) {
    if (op.dataset.otra) {
      escribir({ limpiar: true });
      return;
    }
    input.value = op.dataset.marca;
    sincronizar();
    if (conPuntero && !sinMovimiento.matches) {
      // Mientras se pliega, Tab o Enter no tienen que tomar otra opción activa.
      activar(null);
      op.classList.add('confirmando');
      cierrePendiente = true;
      timerCierre = window.setTimeout(cerrar, 180);
    } else {
      cerrar();
    }
    volverAElegir();
    confirmar();
    input.dispatchEvent(new Event('change', { bubbles: true }));
    alElegir(input.value);
  }

  /**
   * Abre el teclado para escribir la marca: "Escribir la marca", segundo toque en el campo
   * (selecciona lo escrito, así lo nuevo lo reemplaza) u "Otra marca" (deja el campo vacío).
   */
  function escribir({ limpiar = false } = {}) {
    escribiendo = true;
    let limpiado = false;
    if (limpiar && marcaExacta(input.value)) {
      input.value = '';
      sincronizar();
      filtrar('');
      limpiado = true;
    }
    // El blur y el foco que siguen solo sirven para que aparezca el teclado: no son "salir del campo".
    ignorarBlur = true;
    if (document.activeElement === input) input.blur();
    aplicarModoPuntero();
    input.focus({ preventScroll: true });
    ignorarBlur = false;
    if (!abierto) abrir({ animar: false });
    if (input.value) input.select();
    // Que el resto del formulario se entere de que la marca quedó vacía (modelo, borrador).
    if (limpiado) input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function usarTexto() {
    cerrar();
    volverAElegir();
    confirmar();
    input.dispatchEvent(new Event('change', { bubbles: true }));
    alElegir(input.value);
  }

  // Los logos se piden recién cuando el catálogo está por usarse (no pesan en la portada).
  let logosPedidos = false;
  function precargarLogos() {
    if (logosPedidos) return;
    logosPedidos = true;
    for (const img of lista.querySelectorAll('img[loading="lazy"]')) img.loading = 'eager';
  }

  /** Pliega el catálogo si el foco ya no volvió al campo. */
  function plegarSiSalio() {
    clearTimeout(timerPlegar);
    timerPlegar = window.setTimeout(() => {
      if (document.activeElement !== input) cerrar();
    }, 0);
  }

  // ---------- Eventos ----------
  // Saber si hay un puntero apretado: el catálogo se pliega recién cuando se suelta (ver blur).
  document.addEventListener('pointerdown', () => { punteroApretado = true; }, true);
  const soltarPuntero = () => { punteroApretado = false; };
  document.addEventListener('pointerup', soltarPuntero, true);
  document.addEventListener('pointercancel', soltarPuntero, true);

  input.addEventListener('pointerdown', precargarLogos);
  input.addEventListener('focus', () => {
    if (!ignorarBlur) abrir();
  });
  input.addEventListener('click', () => {
    if (!abierto) abrir();
    if (!punteroGrueso.matches || escribiendo) return;
    // Primera activación: catálogo sin teclado. Segunda (catálogo abierto): ahora sí, el teclado.
    // Si el foco llegó solo (por ejemplo, al marcar un error), no hay clic: la primera del usuario todavía no lo abre.
    toquesEnCampo += 1;
    if (toquesEnCampo >= 2) escribir({ limpiar: false });
  });
  input.addEventListener('input', () => {
    for (const op of opciones) op.setAttribute('aria-selected', 'false');
    logoCampo.hidden = true;
    combo.classList.remove('con-logo');
    if (!abierto) abrir({ animar: false });
    filtrar(input.value, { auto: true });
  });
  // El blur propio de escribir() no tiene que llegar al formulario (validaría el campo recién vaciado).
  input.addEventListener('focusout', (evento) => {
    if (ignorarBlur) evento.stopPropagation();
  });
  input.addEventListener('blur', () => {
    if (ignorarBlur) return;
    toquesEnCampo = 0;
    volverAElegir();
    confirmar();
    activar(null);
    if (!abierto) return;
    // Plegar en el acto correría la página bajo el puntero y el clic caería en otro lado:
    // se pliega después del clic que sacó el foco (con tope por si el pointerup no llega, p. ej., un <select>).
    if (punteroApretado) {
      document.addEventListener('pointerup', plegarSiSalio, { capture: true, once: true });
      clearTimeout(timerPlegar);
      timerPlegar = window.setTimeout(() => {
        if (document.activeElement !== input) cerrar();
      }, 1000);
    } else {
      // Con el dedo, el pointerup ya pasó: mousedown, mouseup y click llegan en la misma tarea.
      plegarSiSalio();
    }
  });
  input.addEventListener('keydown', (evento) => {
    if (evento.isComposing) return;
    if (cierrePendiente) cerrar(); // recién eligieron con el puntero: el catálogo ya no cuenta como abierto
    const vis = visibles();
    const i = activa ? vis.indexOf(activa) : -1;
    const cursorAlFinal = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    const mover = (op) => activar(op ?? null);
    switch (evento.key) {
      case 'ArrowDown':
        evento.preventDefault();
        if (!abierto) {
          abrir();
          return;
        }
        mover(vis[i < 0 ? 0 : Math.min(vis.length - 1, i + 1)]);
        break;
      case 'ArrowUp':
        if (!abierto) return;
        evento.preventDefault();
        if (i < 0) return;
        mover(i > 0 ? vis[i - 1] : null);
        break;
      case 'ArrowRight':
        // Con una opción que propuso el filtro, → mueve el cursor del texto hasta que llega al final.
        if (!abierto || i < 0 || (activaAuto && !cursorAlFinal)) return;
        evento.preventDefault();
        mover(vis[Math.min(vis.length - 1, i + 1)]);
        break;
      case 'ArrowLeft':
      case 'Home':
      case 'End':
        // ←, Inicio y Fin mueven el cursor del texto, salvo que la persona ya esté recorriendo la lista.
        if (!abierto || i < 0 || activaAuto) return;
        evento.preventDefault();
        if (evento.key === 'ArrowLeft') mover(vis[Math.max(0, i - 1)]);
        else mover(evento.key === 'Home' ? vis[0] : vis[vis.length - 1]);
        break;
      case 'Enter':
        if (abierto && activa) {
          // Elegida con las flechas: Enter solo elige. Propuesta por el filtro ("toy" → Toyota):
          // la elige y deja seguir el Enter, que pasa al campo siguiente.
          if (!activaAuto) evento.preventDefault();
          elegir(activa);
        } else {
          cerrar();
          volverAElegir();
          confirmar();
        }
        break;
      case 'Escape':
        if (abierto) {
          evento.preventDefault();
          evento.stopPropagation();
          cerrar();
        }
        break;
      case 'Tab':
        if (abierto && activa && !activa.dataset.otra) elegir(activa);
        else cerrar();
        break;
      default:
        break;
    }
  });

  boton.addEventListener('mousedown', (evento) => evento.preventDefault());
  boton.addEventListener('click', () => {
    if (abierto) {
      cerrar();
      return;
    }
    if (document.activeElement === input) abrir();
    else input.focus({ preventScroll: true });
  });

  // Tocar el catálogo no le saca el foco al campo (así no se cierra antes del clic).
  catalogo.addEventListener('mousedown', (evento) => evento.preventDefault());
  catalogo.addEventListener('click', (evento) => {
    if (evento.target.closest('.catalogo-escribir')) {
      escribir({ limpiar: false });
      return;
    }
    if (evento.target.closest('.vacio-usar')) {
      usarTexto();
      return;
    }
    const op = evento.target.closest('.marca');
    if (!op || op.hidden) return;
    // Un clic o un toque elige la marca (en el celular alcanza con un toque).
    elegir(op, { conPuntero: true });
  });

  /**
   * Que cada nombre entre en su tarjeta con al menos 6 px de aire por lado: primero se achica
   * (hasta 10 px); si así tampoco entra, pasa a dos líneas con guion ("Mercedes-" / "Benz").
   */
  const medidor = document.createRange();
  function anchoTexto(s) {
    medidor.selectNodeContents(s);
    // En medidas de maqueta: si el paso está entrando (con escala), el rectángulo visible es más chico.
    const escala = s.getBoundingClientRect().width / (s.offsetWidth || 1) || 1;
    return medidor.getBoundingClientRect().width / escala;
  }
  function ajustarNombres() {
    for (const s of lista.querySelectorAll('.marca:not(.marca--otra) .marca-nombre')) {
      s.style.fontSize = '';
      s.style.letterSpacing = '';
      s.classList.remove('en-dos');
      const estilo = getComputedStyle(s);
      const disponible = s.clientWidth - parseFloat(estilo.paddingLeft) - parseFloat(estilo.paddingRight);
      if (disponible <= 0) continue;
      const base = parseFloat(estilo.fontSize);
      let tam = base;
      let vueltas = 0;
      while (anchoTexto(s) > disponible + 0.5 && tam > 10 && vueltas++ < 12) {
        tam -= 0.5;
        s.style.fontSize = `${tam}px`;
        s.style.letterSpacing = '-0.02em';
      }
      if (anchoTexto(s) <= disponible + 0.5) continue;
      // Ni a 10 px entra en una línea: dos líneas, con el tamaño más grande que entre.
      s.classList.add('en-dos');
      tam = base;
      s.style.fontSize = '';
      s.style.letterSpacing = '';
      vueltas = 0;
      while (anchoTexto(s) > disponible + 0.5 && tam > 10 && vueltas++ < 12) {
        tam -= 0.5;
        s.style.fontSize = `${tam}px`;
        s.style.letterSpacing = '-0.02em';
      }
    }
  }
  let ajustePendiente = 0;
  function programarAjuste() {
    cancelAnimationFrame(ajustePendiente);
    ajustePendiente = requestAnimationFrame(ajustarNombres);
  }
  if ('ResizeObserver' in window) new ResizeObserver(programarAjuste).observe(grupoTodas.querySelector('.grilla'));
  document.fonts?.ready.then(programarAjuste);

  punteroGrueso.addEventListener?.('change', aplicarModoPuntero);
  aplicarModoPuntero();
  sincronizar();

  return {
    abrir,
    cerrar,
    confirmar,
    sincronizar,
    /** Compatibilidad con combobox.js: refresca el estado visible. */
    actualizar: sincronizar,
  };
}
