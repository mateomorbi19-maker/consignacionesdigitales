/* =========================================================================
   Catálogo de marcas con logos (campo "Marca" del paso 1).
   Patrón ARIA 1.2 de combobox con un listbox dibujado en grilla: el foco
   queda siempre en el input y la opción activa se anuncia con
   aria-activedescendant. Mantiene el mismo contrato que combobox.js
   (confirmar al elegir, con Enter, con Tab o al salir del campo, y el evento
   "change" para el borrador), así que app.js no cambia su lógica.
   - Con mouse: al pasar por un logo aparece el nombre; un clic lo elige.
   - Con el dedo: el primer toque muestra el nombre; el segundo, lo elige.
   - En el celular, tocar el campo despliega el catálogo sin abrir el
     teclado; tocarlo otra vez (o "Otra marca") abre el teclado para escribir.
   - Escribir filtra los logos y se puede dejar una marca que no está.
   ========================================================================= */

import { normalizar } from './combobox.js';

const ICONO_CHECK = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>';
const ICONO_LAPIZ =
  '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>';

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
 * @param {() => void} [cfg.alElegir]        se llama después de elegir con un clic o un toque
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
  let revelada = null;
  let tipoPuntero = 'mouse';
  let escribiendo = false;
  let ignorarBlur = false;
  let toquesEnCampo = 0; // toques del usuario en el campo con el catálogo abierto (el segundo abre el teclado)
  let timerEntrada = 0;
  let timerCierre = 0;

  // ---------- Construcción del listbox ----------
  const idBase = lista.id;
  const crearOpcion = (marca, grupo, indice) => {
    const s = slug(marca);
    const ancho = logos.get(s);
    const op = document.createElement('div');
    op.className = ancho ? 'marca' : 'marca marca--texto';
    op.id = `${idBase}-${grupo}-${s}`;
    op.setAttribute('role', 'option');
    op.setAttribute('aria-selected', 'false');
    op.dataset.marca = marca;
    op.style.setProperty('--i', String(indice));
    if (ancho) {
      const img = document.createElement('img');
      img.className = 'marca-imagen';
      img.src = `img/marcas/${s}.webp`;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.draggable = false;
      img.style.setProperty('--w', String(ancho));
      op.append(img);
    }
    const nombre = document.createElement('span');
    nombre.className = 'marca-nombre';
    nombre.textContent = marca;
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
    if (punteroGrueso.matches && !escribiendo) input.setAttribute('inputmode', 'none');
    else input.removeAttribute('inputmode');
  }

  // ---------- Estado ----------
  const marcaExacta = (valor) => {
    const n = normalizar(valor);
    return n ? marcas.find((marca) => normalizar(marca) === n) : undefined;
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

  function revelar(op) {
    revelada?.classList.remove('revelada');
    revelada = op;
    op?.classList.add('revelada');
  }

  function activar(op, { desplazar = true } = {}) {
    activa?.classList.remove('activa');
    activa = op;
    if (op) {
      op.classList.add('activa');
      input.setAttribute('aria-activedescendant', op.id);
      if (desplazar) mostrar(op);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  /** Desplaza solo lo necesario para que la opción activa se vea entera. */
  function mostrar(op) {
    const r = op.getBoundingClientRect();
    const interno = desplazable.scrollHeight > desplazable.clientHeight + 1;
    if (interno) {
      const c = desplazable.getBoundingClientRect();
      if (r.top < c.top + 8) desplazable.scrollTop -= c.top + 8 - r.top;
      else if (r.bottom > c.bottom - 8) desplazable.scrollTop += r.bottom - c.bottom + 8;
      return;
    }
    const vv = window.visualViewport;
    const arriba = (vv?.offsetTop ?? 0) + 12;
    const abajo = (vv ? vv.offsetTop + vv.height : window.innerHeight) - 12;
    if (r.top < arriba) window.scrollBy({ top: r.top - arriba });
    else if (r.bottom > abajo) window.scrollBy({ top: r.bottom - abajo });
  }

  const visibles = () => opciones.filter((op) => !op.hidden && !op.closest('.grupo').hidden);
  const columnas = () => getComputedStyle(grupoTodas.querySelector('.grilla')).gridTemplateColumns.split(' ').length;

  // Mismo criterio que combobox.js: exacta, empieza con, palabra que empieza con, contiene.
  function filtrar(texto) {
    const n = normalizar(texto);
    const rango = (nombre) =>
      nombre === n ? 0 : nombre.startsWith(n) ? 1 : nombre.split(/[\s-]+/).some((p) => p.startsWith(n)) ? 2 : nombre.includes(n) ? 3 : 9;
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
      const r = n ? rango(normalizar(op.dataset.marca)) : 0;
      op.hidden = r === 9;
      if (r !== 9) hay++;
      if (n && r < mejorRango) {
        mejor = op;
        mejorRango = r;
      }
    }
    vacio.hidden = !(n && hay === 0);
    for (const s of textosVacio) s.textContent = texto.replace(/\s+/g, ' ').trim();
    revelar(null);
    activar(n ? mejor : null);
  }

  function abrir({ animar = true } = {}) {
    if (input.disabled) return;
    clearTimeout(timerCierre);
    if (abierto) return;
    abierto = true;
    filtrar(marcaExacta(input.value) ? '' : input.value);
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
    toquesEnCampo = 0;
    for (const op of lista.querySelectorAll('.confirmando')) op.classList.remove('confirmando');
    if (!abierto) return;
    abierto = false;
    catalogo.classList.remove('abierto', 'entrando', 'filtrando');
    combo.removeAttribute('data-abierto');
    input.setAttribute('aria-expanded', 'false');
    boton.setAttribute('aria-expanded', 'false');
    revelar(null);
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
      op.classList.add('confirmando');
      timerCierre = window.setTimeout(cerrar, 180);
    } else {
      cerrar();
    }
    volverAElegir();
    confirmar();
    input.dispatchEvent(new Event('change', { bubbles: true }));
    alElegir();
  }

  /**
   * Abre el teclado para escribir la marca: segundo toque en el campo (selecciona
   * lo escrito, así lo nuevo lo reemplaza) u "Otra marca" (deja el campo vacío).
   */
  function escribir({ limpiar = false } = {}) {
    escribiendo = true;
    if (limpiar && marcaExacta(input.value)) {
      input.value = '';
      sincronizar();
      filtrar('');
    }
    ignorarBlur = true;
    if (document.activeElement === input) input.blur();
    aplicarModoPuntero();
    input.focus({ preventScroll: true });
    ignorarBlur = false;
    if (!abierto) abrir({ animar: false });
    if (input.value) input.select();
  }

  function usarTexto() {
    cerrar();
    volverAElegir();
    confirmar();
    input.dispatchEvent(new Event('change', { bubbles: true }));
    alElegir();
  }

  // Los logos se piden recién cuando el catálogo está por usarse (no pesan en la portada).
  let logosPedidos = false;
  function precargarLogos() {
    if (logosPedidos) return;
    logosPedidos = true;
    for (const img of lista.querySelectorAll('img[loading="lazy"]')) img.loading = 'eager';
  }

  // ---------- Eventos ----------
  input.addEventListener('pointerdown', (evento) => {
    tipoPuntero = evento.pointerType || 'mouse';
    precargarLogos();
  });
  input.addEventListener('focus', () => {
    if (!ignorarBlur) abrir();
  });
  input.addEventListener('click', () => {
    if (!abierto) abrir();
    const toque = tipoPuntero === 'touch' || tipoPuntero === 'pen';
    if (!toque || !punteroGrueso.matches || escribiendo) return;
    // Primer toque: catálogo sin teclado. Segundo toque en el campo (catálogo abierto): ahora sí, el teclado.
    // Si el foco llegó solo (por ejemplo, al marcar un error), el primer toque del usuario todavía no lo abre.
    toquesEnCampo += 1;
    if (toquesEnCampo >= 2) escribir({ limpiar: false });
  });
  input.addEventListener('input', () => {
    for (const op of opciones) op.setAttribute('aria-selected', 'false');
    logoCampo.hidden = true;
    combo.classList.remove('con-logo');
    if (!abierto) abrir({ animar: false });
    filtrar(input.value);
  });
  input.addEventListener('blur', () => {
    if (ignorarBlur) return;
    cerrar();
    volverAElegir();
    confirmar();
  });
  input.addEventListener('keydown', (evento) => {
    if (evento.isComposing) return;
    const vis = visibles();
    const i = activa ? vis.indexOf(activa) : -1;
    const cols = columnas();
    switch (evento.key) {
      case 'ArrowDown':
        evento.preventDefault();
        if (!abierto) {
          abrir();
          return;
        }
        revelar(null);
        activar(vis[i < 0 ? 0 : Math.min(vis.length - 1, i + cols)] ?? null);
        break;
      case 'ArrowUp':
        if (!abierto) return;
        evento.preventDefault();
        if (i < 0) return;
        activar(i - cols >= 0 ? vis[i - cols] : null);
        break;
      case 'ArrowRight':
        if (!abierto || i < 0) return;
        evento.preventDefault();
        activar(vis[Math.min(vis.length - 1, i + 1)]);
        break;
      case 'ArrowLeft':
        if (!abierto || i < 0) return;
        evento.preventDefault();
        activar(vis[Math.max(0, i - 1)]);
        break;
      case 'Home':
      case 'End':
        if (!abierto || i < 0) return;
        evento.preventDefault();
        activar(evento.key === 'Home' ? vis[0] : vis[vis.length - 1]);
        break;
      case 'Enter':
        if (abierto && activa) {
          evento.preventDefault();
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

  boton.addEventListener('pointerdown', (evento) => {
    tipoPuntero = evento.pointerType || 'mouse';
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
  catalogo.addEventListener('pointerdown', (evento) => {
    tipoPuntero = evento.pointerType || 'mouse';
  });
  catalogo.addEventListener('click', (evento) => {
    if (evento.target.closest('.vacio-usar')) {
      usarTexto();
      return;
    }
    const op = evento.target.closest('.marca');
    if (!op || op.hidden) {
      revelar(null);
      return;
    }
    const toque = tipoPuntero === 'touch' || tipoPuntero === 'pen';
    if (toque && !op.dataset.otra && revelada !== op) {
      revelar(op);
      activar(null);
      return;
    }
    elegir(op, { conPuntero: true });
  });

  // Si un nombre largo no entra en su tarjeta (p. ej., "Volkswagen" en un celular de 360 px), se achica
  // apenas y se cierra un poco el espaciado, hasta 10 px como mínimo: nunca queda cortado.
  function ajustarNombres() {
    for (const s of lista.querySelectorAll('.marca:not(.marca--otra) .marca-nombre')) {
      s.style.fontSize = '';
      s.style.letterSpacing = '';
      let tam = parseFloat(getComputedStyle(s).fontSize);
      let vueltas = 0;
      while (s.scrollWidth > s.clientWidth + 0.5 && tam > 10 && vueltas++ < 12) {
        tam -= 0.5;
        s.style.fontSize = `${tam}px`;
        s.style.letterSpacing = '-0.025em';
      }
    }
  }
  if ('ResizeObserver' in window) {
    let pendiente = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(pendiente);
      pendiente = requestAnimationFrame(ajustarNombres);
    }).observe(grupoTodas.querySelector('.grilla'));
  }
  document.fonts?.ready.then(ajustarNombres);

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
