/**
 * Compartir una ruta por enlace sin servidor: la ruta simplificada, la hora de
 * salida y el ritmo van comprimidos dentro del propio enlace, detrás de "#",
 * que el navegador nunca envía a ningún servidor.
 *
 * Formato: #r=<base64url(deflate-raw(JSON))>
 *   { v: 1, n: nombre, p: polilínea (lat/lon, 5 decimales), e: altitudes en m
 *     (misma codificación, opcional), t: salida (ms), s: 'bike'|'run', k: km/h }
 */

import { buildTrack, sliceTrack } from './geo.js';

export const SHARE_VERSION = 1;

// --- Polilínea (algoritmo de Google): enteros con signo en base64 de 5 bits ---

function encodeSigned(n) {
  let v = n < 0 ? ~(n << 1) : n << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

function decodeSigned(str, pos) {
  let result = 0;
  let shift = 0;
  let b;
  do {
    b = str.charCodeAt(pos.i++) - 63;
    result |= (b & 0x1f) << shift;
    shift += 5;
  } while (b >= 0x20);
  return result & 1 ? ~(result >> 1) : result >> 1;
}

/** Codifica una serie de enteros como diferencias sucesivas. */
export function encodeInts(values) {
  let prev = 0;
  let out = '';
  for (const v of values) {
    out += encodeSigned(v - prev);
    prev = v;
  }
  return out;
}

export function decodeInts(str) {
  const pos = { i: 0 };
  const out = [];
  let prev = 0;
  while (pos.i < str.length) {
    prev += decodeSigned(str, pos);
    out.push(prev);
  }
  return out;
}

export function encodePolyline(points) {
  let lat = 0;
  let lon = 0;
  let out = '';
  for (const p of points) {
    const la = Math.round(p.lat * 1e5);
    const lo = Math.round(p.lon * 1e5);
    out += encodeSigned(la - lat) + encodeSigned(lo - lon);
    lat = la;
    lon = lo;
  }
  return out;
}

export function decodePolyline(str) {
  const pos = { i: 0 };
  const out = [];
  let lat = 0;
  let lon = 0;
  while (pos.i < str.length) {
    lat += decodeSigned(str, pos);
    lon += decodeSigned(str, pos);
    out.push({ lat: lat / 1e5, lon: lon / 1e5 });
  }
  return out;
}

// --- Simplificación (Douglas-Peucker) y recorte de los extremos ---

/** Distancia en metros de p al segmento a-b (proyección local equirectangular). */
function segDistance(p, a, b) {
  const k = Math.cos((a.lat * Math.PI) / 180) * 111320;
  const ax = a.lon * k;
  const ay = a.lat * 110540;
  const bx = b.lon * k - ax;
  const by = b.lat * 110540 - ay;
  const px = p.lon * k - ax;
  const py = p.lat * 110540 - ay;
  const len2 = bx * bx + by * by;
  const t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
  return Math.hypot(px - t * bx, py - t * by);
}

/** Simplifica la ruta manteniendo cada punto a menos de `tolerance` metros del original. */
export function simplify(points, tolerance = 10) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDistance(points[i], points[a], points[b]);
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (max > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Quita los primeros y últimos `meters` metros (suelen ser la casa de quien comparte).
 * En rutas cortas (menos de 4 veces esa distancia) no recorta nada.
 */
export function trimEnds(track, meters = 500) {
  if (!(meters > 0) || track.total < meters * 4) return track.points.slice();
  return sliceTrack(track, meters, track.total - meters);
}

// --- Compresión y base64url ---

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class ShareError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/**
 * Genera el fragmento del enlace (sin "#") para una ruta.
 * Ajusta la simplificación hasta que el fragmento cabe en `maxLength` caracteres.
 * @param {object} track Resultado de buildTrack.
 * @param {{name?, startMs?, sport?, speedKmh?, hideMeters?, maxLength?}} opts
 */
export async function encodeShare(track, opts = {}) {
  const { name = '', startMs, sport, speedKmh, hideMeters = 500, maxLength = 7000, tolerance: startTolerance = 5 } = opts;
  const base = trimEnds(track, hideMeters);
  let tolerance = startTolerance;
  for (let attempt = 0; attempt < 12; attempt++) {
    const pts = simplify(base, tolerance);
    const hasEle = pts.every((p) => Number.isFinite(p.ele));
    const payload = { v: SHARE_VERSION, n: String(name).slice(0, 120), p: encodePolyline(pts) };
    if (hasEle) payload.e = encodeInts(pts.map((p) => Math.round(p.ele)));
    if (Number.isFinite(startMs)) payload.t = Math.round(startMs / 60_000) * 60_000;
    if (sport) payload.s = sport;
    if (speedKmh > 0) payload.k = Math.round(speedKmh * 100) / 100;
    const json = new TextEncoder().encode(JSON.stringify(payload));
    const hash = `r=${toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))}`;
    if (hash.length <= maxLength) return { hash, points: pts.length, tolerance };
    tolerance *= 1.6;
  }
  throw new ShareError('too_long');
}

/**
 * Lee un fragmento "r=…" (con o sin "#"). Devuelve null si no hay ruta compartida.
 * @returns {Promise<{name, points, startMs, sport, speedKmh}|null>}
 */
export async function decodeShare(hash) {
  const m = String(hash || '').match(/(?:^#?|&)r=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  let data;
  try {
    const bytes = await pipe(fromBase64Url(m[1]), new DecompressionStream('deflate-raw'));
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ShareError('bad_link');
  }
  if (!data || data.v !== SHARE_VERSION || typeof data.p !== 'string') throw new ShareError('bad_link');
  const coords = decodePolyline(data.p);
  const eles = data.e ? decodeInts(data.e) : [];
  if (coords.length < 2) throw new ShareError('bad_link');
  const points = coords.map((c, i) => ({ ...c, ele: Number.isFinite(eles[i]) ? eles[i] : null }));
  return {
    name: typeof data.n === 'string' ? data.n : '',
    points,
    startMs: Number.isFinite(data.t) ? data.t : null,
    sport: data.s === 'run' ? 'run' : data.s === 'bike' ? 'bike' : null,
    speedKmh: data.k > 0 ? data.k : null,
  };
}

/** Diferencia máxima (m) entre la ruta original y la compartida, para los tests. */
export function maxDeviation(original, shared) {
  const t = buildTrack(shared);
  let max = 0;
  for (const p of original) {
    let best = Infinity;
    for (let i = 0; i < t.points.length - 1; i++) best = Math.min(best, segDistance(p, t.points[i], t.points[i + 1]));
    max = Math.max(max, best);
  }
  return max;
}
