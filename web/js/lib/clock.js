/** Hora escrita a mano → minutos desde medianoche, y ayudas para el selector de salida. */

/**
 * Acepta "8", "08", "830", "0830", "8:30", "8.30", "8h30", "8 30", "20h".
 * @returns {number|null} minutos desde las 00:00, o null si no es una hora válida.
 */
export function parseClock(text) {
  const s = String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  let m = s.match(/^(\d{1,2})(?:\s*[:.h ]\s*(\d{1,2}))?\s*h?$/);
  if (!m) m = s.match(/^(\d{1,2})(\d{2})$/); // 830, 0830, 2015
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export const formatClock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Suma `delta` minutos dando la vuelta al día y redondeando al múltiplo de `delta`. */
export function stepClock(minutes, delta) {
  const step = Math.abs(delta);
  const base = delta > 0 ? Math.floor(minutes / step) * step : Math.ceil(minutes / step) * step;
  const next = base === minutes ? minutes + delta : delta > 0 ? base + step : base - step;
  return ((next % 1440) + 1440) % 1440;
}

/** Días seleccionables: desde hoy (local) durante `count` días, como 'YYYY-MM-DD'. */
export function nextDays(nowMs, count) {
  const out = [];
  const d = new Date(nowMs);
  d.setHours(12, 0, 0, 0); // mediodía: evita saltos por cambio de hora
  for (let i = 0; i < count; i++) {
    const pad = (n) => String(n).padStart(2, '0');
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}
