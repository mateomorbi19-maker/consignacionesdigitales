/* =========================================================================
   Origen del tráfico y medición de la campaña.
   - Guarda las UTM y los click IDs de los anuncios (fbclid, gclid, ...) para
     que cada envío llegue con su origen.
   - track(): empuja eventos a dataLayer (GTM) y, si están instalados,
     avisa a Meta Pixel ('Lead') y a GA4 ('generate_lead').
   ========================================================================= */

const CLAVES = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'gclid', 'gbraid', 'wbraid', 'fbclid', 'ttclid', 'msclkid'];
const CLAVE_ALMACEN = 'surcars:consignacion:origen';

export function capturarOrigen() {
  const parametros = new URLSearchParams(window.location.search);
  const actual = {};
  for (const clave of CLAVES) {
    const valor = parametros.get(clave);
    if (valor) actual[clave] = valor.slice(0, 300);
  }

  let guardado = null;
  try {
    guardado = JSON.parse(window.sessionStorage.getItem(CLAVE_ALMACEN) || 'null');
  } catch {
    guardado = null;
  }

  // Si la visita trae UTM nuevas, mandan esas; si no, se conserva el origen de la sesión.
  const origen =
    Object.keys(actual).length || !guardado || typeof guardado !== 'object'
      ? { ...actual, landing_url: window.location.href.slice(0, 500), referrer: document.referrer.slice(0, 500) }
      : guardado;

  try {
    window.sessionStorage.setItem(CLAVE_ALMACEN, JSON.stringify(origen));
  } catch {
    /* modo privado o almacenamiento bloqueado: seguimos sin guardar */
  }
  return origen;
}

export function track(evento, datos = {}) {
  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: evento, ...datos });
    if (evento === 'consignacion_lead') {
      if (typeof window.fbq === 'function') window.fbq('track', 'Lead', { content_name: 'Consignación' });
      if (typeof window.gtag === 'function') window.gtag('event', 'generate_lead', { form_name: 'consignacion' });
    }
  } catch {
    /* la medición nunca debe romper el formulario */
  }
}
