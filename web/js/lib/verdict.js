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
const WIND_DELAY = 5 * 60_000; // a partir de 5 min de retraso o adelanto se menciona

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
  const { start, end } = plan.sun || {};
  const dark = (t, sun) => Boolean(sun) && (t < sun.sunrise || t > sun.sunset);
  const daylightInside = [start, end].some((sun) => sun && plan.startMs < sun.sunset && plan.endMs > sun.sunrise);
  if (dark(plan.startMs, start) && dark(plan.endMs, end) && !daylightInside) add('vDarkAll');
  else {
    if (start && plan.startMs < start.sunrise) add('vDarkStart', { sunriseMs: start.sunrise, beforeMs: start.sunrise - plan.startMs });
    if (end && plan.endMs > end.sunset) add('vDarkEnd', { sunsetMs: end.sunset, afterMs: plan.endMs - end.sunset });
  }

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
  // Lo que el viento cambia la llegada (ritmo con viento, lib/pacing.js), si se nota.
  if (plan.windDelayMs >= WIND_DELAY) add('vWindSlow', { delayMs: plan.windDelayMs });
  else if (plan.windDelayMs <= -WIND_DELAY) add('vWindFast', { delayMs: -plan.windDelayMs });
  if (plan.summary.gustMax >= GUSTS_STRONG) add('vGusts', { kmh: plan.summary.gustMax });

  // Lluvia: desde dónde es probable, o si apenas hay.
  const wet = plan.markers.find((m) => m.weather && m.weather.precipProb >= RAIN_LIKELY);
  if (wet) add('vRainFrom', { timeMs: wet.time, km: wet.d, pct: wet.weather.precipProb });
  else if (plan.summary.precipProbMax >= RAIN_SOME) add('vRainLow', { pct: plan.summary.precipProbMax });
  else if (ws.length) add('vRainNone');

  return out;
}
