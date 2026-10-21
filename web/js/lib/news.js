/**
 * Qué novedades enseñar al abrir la app, sin acceso al almacenamiento: la app guarda
 * en localStorage el id de la última novedad vista.
 *
 * Novedad: { id: 'AAAA-MM-DD', ... }. Los ids son fechas, así que se comparan como texto.
 */

/** Id de la novedad más reciente (o null si no hay ninguna). */
export function latestNews(releases) {
  return releases.reduce((max, r) => (max === null || r.id > max ? r.id : max), null);
}

/**
 * Novedades sin ver, de la más reciente a la más antigua.
 * - Quien ya las vio alguna vez: las posteriores a la última que vio.
 * - Quien ya usaba la app pero nunca las vio: solo la más reciente.
 * - Quien entra por primera vez: ninguna (todo es nuevo para él).
 */
export function unseenNews(releases, seenId, returning) {
  const sorted = [...releases].sort((a, b) => (a.id < b.id ? 1 : -1));
  if (typeof seenId === 'string' && seenId) return sorted.filter((r) => r.id > seenId);
  return returning ? sorted.slice(0, 1) : [];
}
