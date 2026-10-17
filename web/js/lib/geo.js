/** Utilidades geográficas: distancias, rumbos e interpolación sobre el track. */

const R = 6371008.8; // radio medio de la Tierra en metros
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Distancia en metros entre dos puntos {lat, lon} (fórmula de Haversine). */
export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rumbo inicial de a hacia b, en grados (0 = norte, 90 = este). */
export function bearing(a, b) {
  const φ1 = rad(a.lat);
  const φ2 = rad(b.lat);
  const Δλ = rad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Normaliza un ángulo a [0, 360). */
export const norm360 = (a) => ((a % 360) + 360) % 360;

/** Diferencia angular absoluta en [0, 180]. */
export function angleDiff(a, b) {
  const d = Math.abs(norm360(a) - norm360(b));
  return d > 180 ? 360 - d : d;
}

/**
 * Prepara el track: quita puntos repetidos y añade la distancia acumulada `d` (m).
 * @returns {{points: {lat,lon,ele,d}[], total: number}}
 */
export function buildTrack(rawPoints) {
  const points = [];
  let d = 0;
  for (const p of rawPoints) {
    const prev = points[points.length - 1];
    if (prev) {
      const step = haversine(prev, p);
      if (step < 0.01) continue; // punto duplicado
      d += step;
    }
    points.push({ lat: p.lat, lon: p.lon, ele: p.ele ?? null, d });
  }
  return { points, total: d };
}

/** Índice del último punto con distancia <= d (búsqueda binaria). */
function indexAt(points, d) {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].d <= d) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Punto interpolado a una distancia d (m) del inicio. */
export function pointAt(track, d) {
  const { points } = track;
  if (d <= 0) return { ...points[0], d: 0 };
  if (d >= track.total) return { ...points[points.length - 1], d: track.total };
  const i = indexAt(points, d);
  const a = points[i];
  const b = points[Math.min(i + 1, points.length - 1)];
  const span = b.d - a.d;
  const t = span > 0 ? (d - a.d) / span : 0;
  const ele = a.ele !== null && b.ele !== null ? a.ele + (b.ele - a.ele) * t : (a.ele ?? b.ele);
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, ele, d };
}

/**
 * Rumbo "suavizado" alrededor de una distancia: une el punto `window/2` antes
 * con el de `window/2` después, para que el ruido del GPS no lo altere.
 */
export function bearingAround(track, d, window = 200) {
  const half = window / 2;
  let from = Math.max(0, d - half);
  let to = Math.min(track.total, d + half);
  if (to - from < 1) {
    from = Math.max(0, to - 1);
    to = Math.min(track.total, from + 1);
  }
  return bearing(pointAt(track, from), pointAt(track, to));
}

/** Puntos del track entre dos distancias (incluye los extremos interpolados). */
export function sliceTrack(track, from, to) {
  const { points } = track;
  const out = [pointAt(track, from)];
  for (let i = indexAt(points, from) + 1; i < points.length && points[i].d < to; i++) {
    out.push(points[i]);
  }
  out.push(pointAt(track, to));
  return out;
}

/**
 * Desnivel positivo y negativo con un umbral para no sumar el ruido del GPS.
 * Devuelve null si el track no tiene altitudes.
 */
export function elevationStats(track, threshold = 3) {
  const eles = track.points.map((p) => p.ele).filter((e) => e !== null);
  if (eles.length < 2) return null;
  let gain = 0;
  let loss = 0;
  let ref = eles[0];
  for (const e of eles) {
    const diff = e - ref;
    if (diff >= threshold) {
      gain += diff;
      ref = e;
    } else if (diff <= -threshold) {
      loss -= diff;
      ref = e;
    }
  }
  return { gain, loss, min: Math.min(...eles), max: Math.max(...eles) };
}

/** Distancias de muestreo: 0, paso, 2·paso… y siempre el final. */
export function distanceSteps(total, step) {
  if (!(step > 0)) throw new Error('step must be > 0');
  const out = [];
  for (let d = 0; d < total - step * 0.25; d += step) out.push(d);
  out.push(total);
  return out;
}
