/**
 * Lista de rutas recientes (las últimas N), sin acceso al almacenamiento:
 * la app la guarda en localStorage. Cada entrada lleva la ruta comprimida con
 * el mismo formato que los enlaces compartidos (lib/share.js).
 *
 * Entrada: { id, name, km, gain, savedAt, hash }
 */

export const RECENT_MAX = 5;

/** Identificador estable de una ruta: nombre + distancia redondeada + inicio aproximado. */
export function routeId(name, track) {
  const p = track.points[0];
  return [String(name || '').trim().toLowerCase(), Math.round(track.total / 100), p.lat.toFixed(3), p.lon.toFixed(3)].join('|');
}

/** Añade (o sube arriba si ya estaba) una ruta y recorta la lista a `max`. */
export function addRecent(list, entry, max = RECENT_MAX) {
  const rest = (Array.isArray(list) ? list : []).filter((r) => r && r.id !== entry.id);
  return [entry, ...rest].slice(0, max);
}

export function removeRecent(list, id) {
  return (Array.isArray(list) ? list : []).filter((r) => r && r.id !== id);
}

/** Descarta entradas mal formadas (p. ej. de una versión anterior o editadas a mano). */
export function sanitizeRecent(list, max = RECENT_MAX) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((r) => r && typeof r.id === 'string' && typeof r.hash === 'string' && r.hash.startsWith('r=') && Number.isFinite(r.savedAt))
    .slice(0, max);
}
