/**
 * Lector de GPX sin dependencias (funciona igual en el navegador y en Node).
 * Lee los puntos de track (<trkpt>) y, si no hay, los de ruta (<rtept>).
 */

const POINT_RE = /<(?:[\w-]+:)?(trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w-]+:)?\1\s*>)/g;
const NAME_RE = /<(?:[\w-]+:)?name\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?name\s*>/;

function attr(attrs, name) {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`));
  return m ? m[1] : null;
}

function child(body, name) {
  if (!body) return null;
  const m = body.match(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${name}\\s*>`));
  return m ? m[1].trim() : null;
}

function decodeEntities(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

export class GpxError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

/**
 * @param {string} text Contenido del archivo GPX.
 * @returns {{name: string|null, points: {lat:number, lon:number, ele:number|null}[]}}
 */
export function parseGpx(text) {
  if (typeof text !== 'string' || !/<(?:[\w-]+:)?gpx\b/.test(text)) {
    throw new GpxError('not_gpx');
  }

  const found = { trkpt: [], rtept: [] };
  for (const m of text.matchAll(POINT_RE)) {
    const lat = parseFloat(attr(m[2], 'lat'));
    const lon = parseFloat(attr(m[2], 'lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const eleText = child(m[3], 'ele');
    const ele = eleText !== null ? parseFloat(eleText) : NaN;
    found[m[1]].push({ lat, lon, ele: Number.isFinite(ele) ? ele : null });
  }

  const points = found.trkpt.length >= 2 ? found.trkpt : found.rtept;
  if (points.length < 2) throw new GpxError('no_points');

  // El primer <name> del archivo suele ser el de la ruta (metadata o trk).
  const nameMatch = text.match(NAME_RE);
  const name = nameMatch ? decodeEntities(nameMatch[1]) || null : null;

  return { name, points };
}
