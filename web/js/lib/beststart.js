/**
 * Mejor hora de salida: prueba varias salidas dentro de una franja con las series
 * meteorológicas ya descargadas (sin más consultas a la API) y las puntúa.
 * Puntuación = penalización: cuanto más baja, mejor.
 */

import { bearingAround, distanceSteps, pointAt } from './geo.js';
import { makeClock } from './timing.js';
import { isDaylight, weatherAt } from './weather.js';
import { relativeWind, WIND } from './wind.js';
import { nearestSample } from './plan.js';

/** Pesos de cada factor según la prioridad elegida por el usuario. */
export const PRIORITIES = Object.freeze({
  balanced: { wind: 1, rain: 1, temp: 1, dark: 1 },
  wind: { wind: 3, rain: 1, temp: 0.5, dark: 1 },
  rain: { wind: 1, rain: 3, temp: 0.5, dark: 1 },
  temp: { wind: 1, rain: 1, temp: 3, dark: 1 },
});

/** Salidas a probar entre fromMs y toMs (incluidas), cada stepMin minutos. */
export function candidateStarts(fromMs, toMs, stepMin = 30) {
  const step = stepMin * 60_000;
  const out = [];
  for (let t = fromMs; t <= toMs + 1; t += step) out.push(t);
  return out;
}

/**
 * Prepara los puntos de evaluación (cada evalM metros) con su rumbo y su serie,
 * que no dependen de la hora de salida.
 */
export function evaluationPoints(track, samples, { evalM = 500, courseWindow = 200 } = {}) {
  const step = Math.max(evalM, track.total / 400);
  const ds = distanceSteps(track.total, step);
  return ds.slice(0, -1).map((d, i) => {
    const mid = (d + ds[i + 1]) / 2;
    return { d: mid, len: ds[i + 1] - d, course: bearingAround(track, mid, courseWindow), sample: nearestSample(samples, mid), ele: pointAt(track, mid).ele };
  });
}

/**
 * Métricas de una salida concreta.
 * @returns {{startMs, endMs, headKmh, headShare, tailShare, rainAvg, rainMax, tempMin, tempMax, tempPenalty, darkShare, missing}}
 */
export function evaluateStart(points, series, startMs, speedKmh, opts = {}) {
  const { wind: windOpts = {}, comfortMin = 10, comfortMax = 25 } = opts;
  const clock = makeClock(startMs, speedKmh);
  let total = 0;
  let head = 0;
  let headLen = 0;
  let tailLen = 0;
  let rain = 0;
  let rainMax = 0;
  let tempPen = 0;
  let darkLen = 0;
  let tempMin = Infinity;
  let tempMax = -Infinity;
  let missing = 0;
  let endMs = startMs;

  for (const p of points) {
    const time = clock(p.d);
    endMs = Math.max(endMs, time);
    const s = series[p.sample];
    const w = weatherAt(s, time);
    if (!w) {
      missing += p.len;
      continue;
    }
    total += p.len;
    const rel = relativeWind(p.course, w.windDir, w.windSpeed, windOpts);
    head += rel.head * p.len; // positivo en contra, negativo a favor
    if (rel.category === WIND.HEAD) headLen += p.len;
    if (rel.category === WIND.TAIL) tailLen += p.len;
    const prob = Number.isFinite(w.precipProb) ? w.precipProb : 0;
    rain += prob * p.len;
    rainMax = Math.max(rainMax, prob);
    if (Number.isFinite(w.temp)) {
      tempMin = Math.min(tempMin, w.temp);
      tempMax = Math.max(tempMax, w.temp);
      const t = Number.isFinite(w.feels) ? w.feels : w.temp;
      tempPen += (t < comfortMin ? comfortMin - t : t > comfortMax ? t - comfortMax : 0) * p.len;
    }
    if (isDaylight(s, time) === false) darkLen += p.len;
  }

  const n = total || 1;
  return {
    startMs,
    endMs,
    headKmh: head / n,
    headShare: headLen / n,
    tailShare: tailLen / n,
    rainAvg: rain / n,
    rainMax,
    tempMin: Number.isFinite(tempMin) ? tempMin : null,
    tempMax: Number.isFinite(tempMax) ? tempMax : null,
    tempPenalty: tempPen / n,
    darkShare: darkLen / n,
    missing: missing / (total + missing || 1),
  };
}

/**
 * Penalización total (más baja = mejor). Escalas pensadas para que cada factor
 * valga ~1 en un caso "claramente malo": 15 km/h de media en contra, 50 % de
 * probabilidad de lluvia, 5 °C fuera del rango cómodo o la mitad de la ruta de noche.
 */
export function scoreMetrics(m, weights = PRIORITIES.balanced) {
  const wind = m.headKmh / 15; // negativo si de media sopla a favor: bonifica
  const rain = m.rainAvg / 50;
  const temp = m.tempPenalty / 5;
  const dark = m.darkShare * 2;
  return weights.wind * wind + weights.rain * rain + weights.temp * temp + weights.dark * dark;
}

/**
 * Prueba todas las salidas y devuelve la lista ordenada por hora, con la mejor marcada.
 * Las salidas con parte de la ruta fuera del pronóstico quedan sin puntuar.
 */
export function rankStarts({ track, samples, series, speedKmh, fromMs, toMs, stepMin = 30, priority = 'balanced', ...opts }) {
  const points = evaluationPoints(track, samples, opts);
  const weights = PRIORITIES[priority] || PRIORITIES.balanced;
  const list = candidateStarts(fromMs, toMs, stepMin).map((startMs) => {
    const m = evaluateStart(points, series, startMs, speedKmh, opts);
    return { ...m, score: m.missing > 0.05 ? null : scoreMetrics(m, weights) };
  });
  const scored = list.filter((c) => c.score !== null);
  if (scored.length) {
    const best = scored.reduce((a, b) => (b.score < a.score ? b : a));
    const worst = scored.reduce((a, b) => (b.score > a.score ? b : a));
    const span = worst.score - best.score || 1;
    for (const c of list) {
      c.best = c === best;
      // 1 = la mejor de la franja, 0 = la peor (para dibujar barras).
      c.quality = c.score === null ? null : 1 - (c.score - best.score) / span;
    }
  }
  return list;
}
