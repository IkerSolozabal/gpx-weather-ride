/** Formato de cifras y horas según el idioma. */

import { getLang } from '../i18n.js';

const locale = () => (getLang() === 'en' ? 'en-GB' : 'es-ES');

export function km(meters, digits) {
  const v = meters / 1000;
  const d = digits ?? (v < 10 && v % 1 !== 0 ? 1 : 0);
  return v.toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Etiqueta de punto kilométrico: entero si cae en km exacto, con un decimal si no. */
export function kmMark(meters) {
  const v = meters / 1000;
  const exact = Math.abs(v - Math.round(v)) < 0.05;
  return v.toLocaleString(locale(), { maximumFractionDigits: exact ? 0 : 1 });
}

export const num = (v, digits = 0) =>
  Number.isFinite(v) ? v.toLocaleString(locale(), { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '–';

export const temp = (v) => (Number.isFinite(v) ? `${num(v)}°` : '–');

export function time(ms, { withDay = false } = {}) {
  const opts = { hour: '2-digit', minute: '2-digit' };
  if (withDay) opts.weekday = 'short';
  return new Intl.DateTimeFormat(locale(), opts).format(new Date(ms));
}

/** Duración legible: «45 min», «1 h 15 min» o «2 h». */
export function span(ms) {
  const mins = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** true si dos instantes caen en días distintos (hora local). */
export const differentDay = (a, b) => new Date(a).toDateString() !== new Date(b).toDateString();

/** Valor para <input type="datetime-local"> en hora local. */
export function toLocalInput(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Flecha SVG que apunta hacia donde sopla el viento. */
export function arrowSvg(windFromDeg, size = 18, cls = 'arrow') {
  const rot = ((windFromDeg ?? 0) + 180) % 360;
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><g transform="rotate(${rot.toFixed(0)} 12 12)"><path d="M12 2 L18.5 13 H14 V22 H10 V13 H5.5 Z" fill="currentColor"/></g></svg>`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
