/** Ritmos y horas de paso a velocidad media constante (con la pendiente: lib/pacing.js). */

/** "5:30" o "5.5" → segundos por km. Devuelve null si no es válido. */
export function parsePace(text) {
  if (text === null || text === undefined) return null;
  const s = String(text).trim().replace(',', '.');
  let m = s.match(/^(\d{1,2}):([0-5]?\d)$/);
  if (m) {
    const secs = Number(m[1]) * 60 + Number(m[2]);
    return secs > 0 ? secs : null;
  }
  m = s.match(/^\d+(\.\d+)?$/);
  if (m) {
    const secs = Math.round(parseFloat(s) * 60);
    return secs > 0 ? secs : null;
  }
  return null;
}

/** Segundos por km → "m:ss". */
export function formatPace(secPerKm) {
  const total = Math.round(secPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const paceToKmh = (secPerKm) => 3600 / secPerKm;
export const kmhToPace = (kmh) => 3600 / kmh;

/**
 * Devuelve una función distancia (m) → instante (ms epoch).
 * @param {number} startMs Hora de salida en ms.
 * @param {number} speedKmh Velocidad media en km/h.
 */
export function makeClock(startMs, speedKmh) {
  if (!(speedKmh > 0)) throw new Error('speed must be > 0');
  const msPerMeter = 3600 / speedKmh; // 3600 s/h ÷ (km/h) = ms por metro
  return (d) => startMs + d * msPerMeter;
}

/** Duración en ms → "h:mm". */
export function formatDuration(ms) {
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}
