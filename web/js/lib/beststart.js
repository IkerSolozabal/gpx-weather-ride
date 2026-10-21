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

/**
 * Pesos de cada factor según la prioridad elegida por el usuario: el elegido pesa 3
 * y los demás 0,5. La noche pesa siempre 1, porque obliga a llevar luces.
 */
export const PRIORITIES = Object.freeze({
  balanced: { wind: 1, rain: 1, temp: 1, dark: 1 },
  wind: { wind: 3, rain: 0.5, temp: 0.5, dark: 1 },
  rain: { wind: 0.5, rain: 3, temp: 0.5, dark: 1 },
  temp: { wind: 0.5, rain: 0.5, temp: 3, dark: 1 },
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
 * Métricas de una salida concreta. Con `opts.pace` (lib/pacing.js) las horas de paso
 * tienen en cuenta la pendiente y las paradas; sin él, velocidad constante.
 * headKmh: viento medio de cara (a favor resta). headPos y tailPos: media solo de la parte
 * en contra y solo de la parte a favor, en km/h.
 * @returns {{startMs, endMs, headKmh, headPos, tailPos, headShare, tailShare, rainAvg, rainMax, tempMin, tempMax, tempPenalty, darkShare, missing}}
 */
export function evaluateStart(points, series, startMs, speedKmh, opts = {}) {
  const { wind: windOpts = {}, comfortMin = 10, comfortMax = 25, pace } = opts;
  const clock = pace ? (d) => startMs + pace.offset(d) : makeClock(startMs, speedKmh);
  let total = 0;
  let head = 0;
  let headPos = 0;
  let tailPos = 0;
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
    if (rel.head > 0) headPos += rel.head * p.len;
    else tailPos -= rel.head * p.len;
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
    headPos: headPos / n,
    tailPos: tailPos / n,
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
 * valga ~1 en un caso "claramente malo": 15 km/h de media en contra, 40 % de
 * probabilidad de lluvia, 8 °C fuera del rango cómodo o la mitad de la ruta de noche.
 *
 * El viento penaliza el viento en contra; el viento a favor solo resta una quinta parte,
 * para desempatar sin compensar el de cara (30 % en contra y 70 % a favor no gana a 0 % en contra).
 */
export function scoreMetrics(m, weights = PRIORITIES.balanced) {
  const wind = (m.headPos - 0.2 * m.tailPos) / 15
  const rain = m.rainAvg / 40;
  const temp = m.tempPenalty / 8;
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
  return markBest(list);
}

/** Marca la mejor (`best`) y da a cada una `quality`: 1 = la mejor de la lista, 0 = la peor. */
function markBest(list) {
  const scored = list.filter((c) => c.score !== null);
  if (scored.length) {
    const best = scored.reduce((a, b) => (b.score < a.score ? b : a));
    const worst = scored.reduce((a, b) => (b.score > a.score ? b : a));
    const span = worst.score - best.score || 1;
    for (const c of list) {
      c.best = c === best;
      c.quality = c.score === null ? null : 1 - (c.score - best.score) / span;
    }
  }
  return list;
}

/** El mismo día que `baseMs` a la hora «HH:MM» (hora local). NaN si la hora no es válida. */
export function atTime(baseMs, hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return NaN;
  const d = new Date(baseMs);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.getTime();
}

/** El mismo reloj local `days` días después (respeta los cambios de hora). */
export function addDays(ms, days) {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/**
 * La misma hora de salida en los próximos días (incluido el elegido), para compararlos.
 * Sin las salidas ya pasadas ni las que acabarían fuera del pronóstico.
 * @returns {{fromMs: number, toMs: number}[]} Una «franja» de un solo instante por día (para rankDays).
 */
export function sameHourDays(startMs, { days = 7, nowMs, limitMs, durationMs }) {
  const out = [];
  for (let k = 0; k < days; k++) {
    const t = addDays(startMs, k);
    if (t + durationMs > limitMs) break;
    if (t >= nowMs) out.push({ fromMs: t, toMs: t });
  }
  return out;
}

/**
 * Mejor salida de cada día: la misma franja horaria en varios días.
 * @param {{days: {fromMs: number, toMs: number}[]}} opts Lo demás, como en rankStarts.
 * @returns La mejor de cada día (o la primera hora sin puntuar si ese día no hay pronóstico), con la mejor de todas marcada.
 */
export function rankDays({ days, ...opts }) {
  const list = days.map(({ fromMs, toMs }) => {
    const day = rankStarts({ ...opts, fromMs, toMs });
    const best = day.find((c) => c.best);
    return best ? { ...best, best: false } : { ...day[0], score: null };
  });
  return markBest(list);
}
