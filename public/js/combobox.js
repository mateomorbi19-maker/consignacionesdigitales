/* =========================================================================
   Combobox accesible con sugerencias (patrón ARIA 1.2 "list autocomplete").
   Sugiere opciones mientras se escribe, pero acepta cualquier texto libre.
   ========================================================================= */

/** Normaliza para comparar: sin tildes, en minúsculas y con espacios simples. */
export function normalizar(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {object} cfg
 * @param {HTMLInputElement} cfg.input
 * @param {HTMLUListElement} cfg.lista      listbox (debe tener id)
 * @param {HTMLButtonElement} [cfg.boton]    botón con la flecha que abre/cierra la lista
 * @param {() => string[]} cfg.opciones      opciones disponibles (se consulta cada vez)
 * @param {(valor: string) => void} [cfg.alConfirmar]  se llama al confirmar un valor
 */
export function crearCombobox({ input, lista, boton, opciones, alConfirmar = () => {}, maximo = 80 }) {
  const contenedor = input.closest('.combo');
  let visibles = [];
  let activo = -1;
  let abierto = false;

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', lista.id);
  if (boton) {
    boton.setAttribute('aria-controls', lista.id);
    boton.setAttribute('aria-expanded', 'false');
  }

  function filtrar() {
    const todas = opciones();
    const consulta = normalizar(input.value);
    if (!consulta) return todas.slice(0, maximo);
    const exactas = [];
    const alInicio = [];
    const inicioDePalabra = [];
    const contienen = [];
    for (const opcion of todas) {
      const n = normalizar(opcion);
      if (n === consulta) exactas.push(opcion);
      else if (n.startsWith(consulta)) alInicio.push(opcion);
      else if (n.split(/[\s-]+/).some((palabra) => palabra.startsWith(consulta))) inicioDePalabra.push(opcion);
      else if (n.includes(consulta)) contienen.push(opcion);
    }
    return [...exactas, ...alInicio, ...inicioDePalabra, ...contienen].slice(0, maximo);
  }

  function pintarOpcion(li, opcion, consulta) {
    const n = normalizar(consulta);
    const base = normalizar(opcion);
    const desde = n ? base.indexOf(n) : -1;
    if (desde < 0 || base.length !== opcion.length) {
      li.textContent = opcion;
      return;
    }
    const resaltado = document.createElement('mark');
    resaltado.textContent = opcion.slice(desde, desde + n.length);
    li.append(opcion.slice(0, desde), resaltado, opcion.slice(desde + n.length));
  }

  function render() {
    const consulta = input.value;
    lista.replaceChildren(
      ...visibles.map((opcion, i) => {
        const li = document.createElement('li');
        li.id = `${lista.id}-op-${i}`;
        li.className = 'combo-opcion';
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', i === activo ? 'true' : 'false');
        li.dataset.indice = String(i);
        pintarOpcion(li, opcion, consulta);
        return li;
      }),
    );
  }

  function abrir() {
    if (input.disabled) {
      cerrar();
      return;
    }
    visibles = filtrar();
    activo = -1;
    if (!visibles.length) {
      cerrar();
      return;
    }
    render();
    lista.scrollTop = 0;
    input.removeAttribute('aria-activedescendant');
    if (!abierto) {
      abierto = true;
      lista.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      boton?.setAttribute('aria-expanded', 'true');
      contenedor?.setAttribute('data-abierto', '');
      asegurarVisible();
    }
  }

  function cerrar() {
    activo = -1;
    if (!abierto) return;
    abierto = false;
    lista.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    boton?.setAttribute('aria-expanded', 'false');
    contenedor?.removeAttribute('data-abierto');
  }

  function mover(indice) {
    if (!visibles.length) return;
    const total = visibles.length;
    activo = ((indice % total) + total) % total;
    for (const li of lista.children) {
      li.setAttribute('aria-selected', Number(li.dataset.indice) === activo ? 'true' : 'false');
    }
    const elegido = lista.children[activo];
    if (elegido) {
      input.setAttribute('aria-activedescendant', elegido.id);
      elegido.scrollIntoView({ block: 'nearest' });
    }
  }

  function elegir(indice) {
    const valor = visibles[indice];
    if (valor === undefined) return;
    input.value = valor;
    cerrar();
    confirmar();
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** Limpia espacios y, si coincide con una opción conocida, usa su escritura oficial. */
  function confirmar() {
    const limpio = input.value.replace(/\s+/g, ' ').trim();
    const n = normalizar(limpio);
    const canonica = n ? opciones().find((opcion) => normalizar(opcion) === n) : undefined;
    const final = canonica ?? limpio;
    if (final !== input.value) input.value = final;
    alConfirmar(final);
  }

  /** En celulares, que la lista no quede tapada por el teclado. */
  function asegurarVisible() {
    if (!window.matchMedia('(max-width: 640px)').matches) return;
    window.setTimeout(() => {
      if (!abierto) return;
      const vv = window.visualViewport;
      const limiteVisible = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const exceso = lista.getBoundingClientRect().bottom - limiteVisible + 12;
      if (exceso <= 0) return;
      const margenArriba = Math.max(0, input.getBoundingClientRect().top - 12);
      window.scrollBy({ top: Math.min(exceso, margenArriba), behavior: 'smooth' });
    }, 320);
  }

  /** Refresca el estado cuando cambian las opciones (p. ej., al cambiar la marca). */
  function actualizar() {
    if (boton) boton.hidden = input.disabled || opciones().length === 0;
    if (abierto) abrir();
  }

  // ---------- Eventos ----------
  input.addEventListener('input', abrir);
  input.addEventListener('click', () => {
    if (!abierto) abrir();
  });
  input.addEventListener('blur', () => {
    cerrar();
    confirmar();
  });
  input.addEventListener('keydown', (evento) => {
    if (evento.isComposing) return;
    switch (evento.key) {
      case 'ArrowDown':
        evento.preventDefault();
        if (!abierto) abrir();
        if (abierto) mover(activo + 1);
        break;
      case 'ArrowUp':
        evento.preventDefault();
        if (!abierto) abrir();
        if (abierto) mover(activo < 0 ? visibles.length - 1 : activo - 1);
        break;
      case 'Enter':
        if (abierto && activo >= 0) {
          evento.preventDefault();
          elegir(activo);
        } else {
          cerrar();
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
        if (abierto && activo >= 0) elegir(activo);
        break;
      default:
        break;
    }
  });

  // Evita que el input pierda el foco al tocar la lista o la flecha.
  lista.addEventListener('mousedown', (evento) => evento.preventDefault());
  lista.addEventListener('click', (evento) => {
    const li = evento.target.closest('[role="option"]');
    if (li) elegir(Number(li.dataset.indice));
  });
  if (boton) {
    boton.addEventListener('mousedown', (evento) => evento.preventDefault());
    boton.addEventListener('click', () => {
      if (abierto) {
        cerrar();
        return;
      }
      input.focus();
      abrir();
    });
  }

  actualizar();
  return { actualizar, cerrar, confirmar };
}
