/**
 * Plan de la ruta: horas de paso, meteo en cada punto y viento por tramos.
 * Las funciones son puras salvo `fetchSeries` y `computePlan`, que piden la meteo.
 */

import { bearingAround, distanceSteps, elevationStats, pointAt, sliceTrack } from './geo.js';
import { makeClock } from './timing.js';
import { fetchForecast, sunTimes, weatherAt } from './weather.js';
import { relativeWind, WIND } from './wind.js';

/**
 * Puntos donde se pide la meteo: uno cada `sampleKm`, más el final.
 * Si salen más de `maxSamples`, se amplía el paso.
 */
export function samplePoints(track, clock, { sampleKm, maxSamples = 200 }) {
  let step = sampleKm * 1000;
  if (track.total / step + 1 > maxSamples) step = track.total / (maxSamples - 1);
  return distanceSteps(track.total, step).map((d) => ({ ...pointAt(track, d), ...(clock ? { time: clock(d) } : {}) }));
}

/** Índice del punto de muestreo más cercano a la distancia d. */
export function nearestSample(samples, d) {
  let best = 0;
  for (let i = 1; i < samples.length; i++) {
    if (Math.abs(samples[i].d - d) < Math.abs(samples[best].d - d)) best = i;
    else if (samples[i].d > d) break;
  }
  return best;
}

/**
 * Une track + series meteorológicas en el resultado que pinta la interfaz.
 * @param {object} track Resultado de buildTrack.
 * @param {object[]} samples Resultado de samplePoints.
 * @param {object[]} series Una serie de Open-Meteo por punto de muestreo.
 * @param {object} opts Con `pace` (lib/pacing.js) las horas de paso tienen en cuenta la
 *   pendiente y las paradas; sin él, velocidad constante `speedKmh`.
 */
export function assemblePlan(track, samples, series, opts) {
  const { startMs, speedKmh, markerKm, segmentM = 250, wind: windOpts = {}, courseWindow = 200, pace } = opts;
  const clock = pace ? (d) => startMs + pace.offset(d) : makeClock(startMs, speedKmh);

  const atDistance = (d) => {
    const time = clock(d);
    const w = weatherAt(series[nearestSample(samples, d)], time);
    const course = bearingAround(track, d, courseWindow);
    const rel = w ? relativeWind(course, w.windDir, w.windSpeed, windOpts) : null;
    return { ...pointAt(track, d), time, weather: w, course, rel };
  };

  // Puntos kilométricos (y la salida y la llegada).
  const markers = distanceSteps(track.total, markerKm * 1000).map(atDistance);

  // Tramos cortos coloreados según el viento relativo.
  const segments = [];
  const share = { [WIND.HEAD]: 0, [WIND.TAIL]: 0, [WIND.CROSS]: 0, [WIND.CALM]: 0, unknown: 0 };
  const cuts = distanceSteps(track.total, segmentM);
  for (let k = 0; k < cuts.length - 1; k++) {
    const from = cuts[k];
    const to = cuts[k + 1];
    const mid = atDistance((from + to) / 2);
    const category = mid.rel ? mid.rel.category : 'unknown';
    share[category] += to - from;
    segments.push({
      from,
      to,
      category,
      head: mid.rel ? mid.rel.head : null,
      coords: sliceTrack(track, from, to).map((p) => [p.lat, p.lon]),
    });
  }

  // Flechas de viento en cada punto de muestreo.
  const arrows = samples.map((s) => atDistance(s.d));

  const ws = arrows.map((a) => a.weather).filter(Boolean);
  const num = (arr) => arr.filter((x) => Number.isFinite(x));
  const temps = num(ws.map((w) => w.temp));
  const total = track.total || 1;

  const endMs = clock(track.total);
  return {
    distance: track.total,
    startMs,
    endMs,
    speedKmh,
    stopMs: pace ? pace.stopMs : 0,
    timeAt: clock,
    // Amanecer del día de salida y anochecer del de llegada (null si la API no los da).
    sun: {
      sunrise: sunTimes(series[0], startMs)?.sunrise ?? null,
      sunset: sunTimes(series[series.length - 1], endMs)?.sunset ?? null,
    },
    elevation: elevationStats(track),
    markers,
    segments,
    arrows,
    missingWeather: ws.length < arrows.length,
    summary: {
      tempMin: temps.length ? Math.min(...temps) : null,
      tempMax: temps.length ? Math.max(...temps) : null,
      windMax: num(ws.map((w) => w.windSpeed)).reduce((a, b) => Math.max(a, b), 0),
      gustMax: num(ws.map((w) => w.gusts)).reduce((a, b) => Math.max(a, b), 0),
      precipProbMax: num(ws.map((w) => w.precipProb)).reduce((a, b) => Math.max(a, b), 0),
      share: Object.fromEntries(Object.entries(share).map(([k, v]) => [k, v / total])),
    },
  };
}

/**
 * Pide la meteo de los puntos de muestreo para una franja de tiempo [fromMs, toMs].
 * Con las series se puede calcular el plan de cualquier salida dentro de la franja
 * sin volver a consultar la API (lo usa la búsqueda de la mejor hora).
 * @returns {Promise<{samples: object[], series: object[], fromMs: number, toMs: number}>}
 */
export async function fetchSeries(track, opts, fetchImpl) {
  const samples = samplePoints(track, null, { sampleKm: opts.sampleKm, maxSamples: opts.maxSamples });
  const series = await fetchForecast(samples, { ...opts.weather, startMs: opts.fromMs, endMs: opts.toMs }, fetchImpl);
  return { samples, series, fromMs: opts.fromMs, toMs: opts.toMs };
}

/**
 * Calcula el plan completo pidiendo la meteo a Open-Meteo.
 * @param {object} track Resultado de buildTrack.
 * @param {object} opts startMs, speedKmh, sampleKm, markerKm, segmentM, wind, weather{baseUrl, apiKey, models, chunkSize}
 */
export async function computePlan(track, opts, fetchImpl) {
  const clock = opts.pace ? (d) => opts.startMs + opts.pace.offset(d) : makeClock(opts.startMs, opts.speedKmh);
  const { samples, series } = await fetchSeries(track, { ...opts, fromMs: opts.startMs, toMs: clock(track.total) }, fetchImpl);
  return assemblePlan(track, samples, series, opts);
}
