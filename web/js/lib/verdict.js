/**
 * Veredicto: el plan resumido en unas pocas frases (noche, temperatura, viento y lluvia).
 * Devuelve claves de i18n con sus valores sin formatear; la app pone el texto.
 *
 * Valores: temp (°C), pct (%), kmh, km (m), *Ms (instante o duración en ms).
 */

import { WIND } from './wind.js';

const RAIN_LIKELY = 50; // % a partir del cual se avisa de la hora de la lluvia
const RAIN_SOME = 20;
const GUSTS_STRONG = 50; // km/h
const WIND_LIGHT = 12; // km/h: por debajo, apenas se nota

/** Reparto del viento en un tramo [from, to) de la ruta: {head, tail} en tanto por uno. */
function windShare(segments, from, to) {
  let len = 0;
  let head = 0;
  let tail = 0;
  for (const s of segments) {
    const a = Math.max(from, s.from);
    const b = Math.min(to, s.to);
    if (b <= a || s.category === 'unknown') continue;
    len += b - a;
    if (s.category === WIND.HEAD) head += b - a;
    if (s.category === WIND.TAIL) tail += b - a;
  }
  return len ? { head: head / len, tail: tail / len } : null;
}

/**
 * @param {object} plan Resultado de assemblePlan.
 * @param {{comfortMin?: number, comfortMax?: number}} opts Rango de temperatura cómoda (sensación).
 * @returns {{key: string, vars: object}[]}
 */
export function verdict(plan, { comfortMin = 10, comfortMax = 25 } = {}) {
  const out = [];
  const add = (key, vars = {}) => out.push({ key, vars });

  // Noche: lo primero, porque obliga a llevar luces.
  const { sunrise, sunset } = plan.sun || {};
  if (sunrise && plan.startMs < sunrise) add('vDarkStart', { sunriseMs: sunrise });
  if (sunset && plan.endMs > sunset) add('vDarkEnd', { sunsetMs: sunset, afterMs: plan.endMs - sunset });

  // Temperatura (por sensación térmica).
  const ws = plan.arrows.map((a) => a.weather).filter(Boolean);
  const feels = ws.map((w) => (Number.isFinite(w.feels) ? w.feels : w.temp)).filter(Number.isFinite);
  const { tempMin, tempMax } = plan.summary;
  if (feels.length && tempMin !== null) {
    const fMin = Math.min(...feels);
    const fMax = Math.max(...feels);
    if (fMin < comfortMin) add('vCold', { temp: tempMin, feels: fMin });
    if (fMax > comfortMax) add('vHot', { temp: tempMax, feels: fMax });
    if (fMin >= comfortMin && fMax <= comfortMax) add('vMild', { min: tempMin, max: tempMax });
  }

  // Viento: ida y vuelta, mayoritario o variable.
  const total = windShare(plan.segments, 0, plan.distance);
  if (total) {
    const first = windShare(plan.segments, 0, plan.distance / 2);
    const second = windShare(plan.segments, plan.distance / 2, plan.distance);
    if (plan.summary.windMax < WIND_LIGHT) add('vWindCalm');
    else if (first && second && first.head >= 0.5 && second.tail >= 0.5) add('vWindHeadThenTail');
    else if (first && second && first.tail >= 0.5 && second.head >= 0.5) add('vWindTailThenHead');
    else if (total.head >= 0.4) add('vWindHead', { pct: total.head * 100 });
    else if (total.tail >= 0.4 && total.head < 0.15) add('vWindTail', { pct: total.tail * 100 });
    else add('vWindMixed', { pct: total.head * 100 });
  }
  if (plan.summary.gustMax >= GUSTS_STRONG) add('vGusts', { kmh: plan.summary.gustMax });

  // Lluvia: desde dónde es probable, o si apenas hay.
  const wet = plan.markers.find((m) => m.weather && m.weather.precipProb >= RAIN_LIKELY);
  if (wet) add('vRainFrom', { timeMs: wet.time, km: wet.d, pct: wet.weather.precipProb });
  else if (plan.summary.precipProbMax >= RAIN_SOME) add('vRainLow', { pct: plan.summary.precipProbMax });
  else if (ws.length) add('vRainNone');

  return out;
}
