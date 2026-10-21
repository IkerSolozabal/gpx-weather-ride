/**
 * Ritmo según la pendiente: reparte el tiempo total (distancia ÷ media que indica el
 * usuario) más despacio en las subidas y más deprisa en las bajadas.
 *
 * El nivel se deduce de la propia ruta: quien hace la misma media en una ruta con
 * más desnivel es más fuerte y sube más rápido.
 * - Bici: modelo de potencia (gravedad + rodadura + aire). Se busca la potencia por kg
 *   con la que, en esta ruta, sale justo la media indicada. Un ciclista flojo pierde
 *   mucho más en los puertos (manda la gravedad) que uno fuerte (en llano manda el aire).
 * - Carrera: coste energético de correr en pendiente (Minetti et al., 2002), la base
 *   del «ritmo ajustado a la pendiente» de Strava, con la misma calibración.
 *
 * Las paradas ({km, min}) retrasan el paso a partir de su punto kilométrico.
 */

import { distanceSteps, pointAt } from './geo.js';

const G = 9.81;
const CRR = 0.006; // rodadura, cubierta de carretera
const AERO = (0.5 * 1.225 * 0.4) / 85; // ½·ρ·CdA ÷ masa: postura de manetas (CdA 0,4 m²), ciclista + bici 85 kg
const MAX_GRADE = 0.3;

/** Límites de velocidad en bici (km/h): frenadas y curvas en bajada, y el mínimo andando. */
export const BIKE_LIMITS = { minKmh: 4, maxKmh: 45 };

/** Tramos de `stepM` metros con su pendiente (0 si el GPX no trae altitudes). */
export function gradeProfile(track, stepM = 200) {
  const ds = distanceSteps(track.total, stepM);
  const pts = ds.map((d) => pointAt(track, d));
  const hasEle = pts.every((p) => Number.isFinite(p.ele));
  const out = [];
  for (let i = 0; i < ds.length - 1; i++) {
    const len = ds[i + 1] - ds[i];
    const grade = hasEle && len > 0 ? (pts[i + 1].ele - pts[i].ele) / len : 0;
    out.push({ from: ds[i], len, grade: Math.max(-MAX_GRADE, Math.min(MAX_GRADE, grade)) });
  }
  return out;
}

/** En las subidas se aprieta más que en llano: +20 % de potencia a partir del 10 %. */
const climbEffort = (grade) => 1 + 2 * Math.max(0, Math.min(0.1, grade));

/** Velocidad en bici (m/s) con `wkg` vatios por kg (en llano) en una pendiente. */
export function bikeSpeed(wkg, grade) {
  const angle = Math.atan(grade);
  const a = G * (Math.sin(angle) + CRR * Math.cos(angle));
  const power = wkg * climbEffort(grade);
  // power = a·v + AERO·v³ tiene una única raíz positiva: bisección.
  let lo = 0;
  let hi = 40;
  for (let k = 0; k < 50; k++) {
    const v = (lo + hi) / 2;
    if (a * v + AERO * v ** 3 < power) lo = v;
    else hi = v;
  }
  return Math.min(BIKE_LIMITS.maxKmh / 3.6, Math.max(BIKE_LIMITS.minKmh / 3.6, lo));
}

/** Coste energético de correr (J/kg/m) en una pendiente (Minetti et al., 2002). En llano, 3,6. */
export function runCost(grade) {
  const i = Math.max(-0.45, Math.min(0.45, grade));
  return 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
}

const movingTime = (segs, wkg) => segs.reduce((t, s) => t + s.len / bikeSpeed(wkg, s.grade), 0);

/** Potencia por kg con la que se hace la ruta a la media indicada (bisección; más potencia, menos tiempo). */
export function bikeLevel(segs, targetSec) {
  let lo = 0.05;
  let hi = 20;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (movingTime(segs, mid) > targetSec) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Paradas válidas, ordenadas, en metros: [{d, ms}]. Sin km (o fuera de la ruta) se ajustan
 * a la ruta; sin km, a mitad de camino. Las de 0 minutos se descartan.
 */
export function normalizeStops(stops, total) {
  return (Array.isArray(stops) ? stops : [])
    .map((s) => ({ km: Number(s && s.km), min: Number(s && s.min) }))
    .filter((s) => s.min > 0)
    .map((s) => ({ d: Number.isFinite(s.km) && s.km >= 0 ? Math.min(total, s.km * 1000) : total / 2, ms: Math.min(s.min, 24 * 60) * 60_000 }))
    .sort((a, b) => a.d - b.d);
}

/**
 * Perfil de tiempos a partir de lo que se tarda en cada tramo (ms) y las paradas.
 * offset(d): ms desde la salida hasta pasar por la distancia d (después de las paradas anteriores).
 */
function timeProfile(track, segs, durations, stopList, extra) {
  const cum = [0];
  for (const ms of durations) cum.push(cum[cum.length - 1] + ms);
  const movingMs = cum[cum.length - 1];
  const stopMs = stopList.reduce((a, s) => a + s.ms, 0);
  // Una parada en el km d cuenta para quien pasa después; la de la meta, para la llegada.
  const stopped = (d) => stopList.reduce((a, s) => a + (d > s.d || (d >= track.total && s.d >= track.total) ? s.ms : 0), 0);

  function moving(d) {
    if (d <= 0 || !segs.length) return 0;
    if (d >= track.total) return movingMs;
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].from <= d) lo = mid;
      else hi = mid - 1;
    }
    const s = segs[lo];
    return cum[lo] + ((d - s.from) / s.len) * (cum[lo + 1] - cum[lo]);
  }

  return { offset: (d) => moving(d) + stopped(d), movingMs, stopMs, totalMs: movingMs + stopMs, stops: stopList, segs, ...extra };
}

/**
 * Tiempo de paso según la distancia, con la pendiente y las paradas.
 * @param {object} track Resultado de buildTrack.
 * @param {{sport: 'bike'|'run', speedKmh: number, stops?: {km: number, min: number}[], stepM?: number}} opts
 * @returns {{offset: (d:number) => number, movingMs: number, stopMs: number, totalMs: number, stops: {d: number, ms: number}[], wkg: number|null}}
 *   wkg: nivel en bici (null corriendo). El total en movimiento es exactamente distancia ÷ media.
 */
export function paceProfile(track, { sport, speedKmh, stops = [], stepM = 200 }) {
  if (!(speedKmh > 0)) throw new Error('speed must be > 0');
  const movingMs = (track.total / 1000 / speedKmh) * 3600_000;
  const segs = track.total > 0 ? gradeProfile(track, stepM) : [];
  const flat = segs.every((s) => s.grade === 0);

  // En bici el nivel hace falta también en llano: con él se calcula el efecto del viento.
  const wkg = sport === 'run' || !segs.length ? null : bikeLevel(segs, movingMs / 1000);
  let weights; // tiempo relativo de cada tramo
  if (flat) weights = segs.map((s) => s.len);
  else if (sport === 'run') weights = segs.map((s) => s.len * runCost(s.grade));
  else weights = segs.map((s) => s.len / bikeSpeed(wkg, s.grade));
  // Se escala para que el total sea exactamente distancia ÷ media.
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const durations = weights.map((w) => (w / sum) * movingMs);
  // scale: ms por unidad de peso; con él, windPace sin viento da exactamente lo mismo.
  const scale = flat || sport === 'run' ? null : movingMs / sum;
  return timeProfile(track, segs, durations, normalizeStops(stops, track.total), { wkg, scale });
}

/** El pronóstico da el viento a 10 m de altura; a la altura del ciclista sopla un tercio menos. */
const WIND_AT_RIDER = 0.65;

/**
 * Velocidad en bici (m/s) con viento: `headMs` es el viento de cara a 10 m, en m/s (negativo, a favor).
 * La resistencia del aire depende de la velocidad respecto al aire. Contra el viento se aprieta
 * algo más, como en las subidas: hasta +10 % con 20 km/h de cara.
 */
export function bikeSpeedWind(wkg, grade, headMs) {
  if (!headMs) return bikeSpeed(wkg, grade);
  const angle = Math.atan(grade);
  const a = G * (Math.sin(angle) + CRR * Math.cos(angle));
  const wind = headMs * WIND_AT_RIDER;
  const power = wkg * climbEffort(grade) * (1 + 0.1 * Math.max(0, Math.min(1, headMs / (20 / 3.6))));
  let lo = 0;
  let hi = 40;
  for (let k = 0; k < 50; k++) {
    const v = (lo + hi) / 2;
    const air = v + wind;
    if (a * v + AERO * air * Math.abs(air) * v < power) lo = v;
    else hi = v;
  }
  return Math.min(BIKE_LIMITS.maxKmh / 3.6, Math.max(BIKE_LIMITS.minKmh / 3.6, lo));
}

/**
 * El mismo ritmo con el viento de cada tramo (solo bici): con el nivel deducido sin viento,
 * cada tramo se recorre a la velocidad que da esa potencia con el aire de cara o a favor.
 * El total ya no es distancia ÷ media: el viento retrasa o adelanta. Corriendo, el efecto
 * es pequeño y se deja igual.
 * @param {object} base Resultado de paceProfile.
 * @param {(d: number, t: number) => number|null} headAt Viento de cara en km/h (negativo, a favor) en la distancia d y el instante t.
 * @param {number} startMs Hora de salida, para saber qué viento hay al pasar por cada tramo.
 * @returns El perfil de paceProfile más windDelayMs (positivo si el viento retrasa).
 */
export function windPace(track, base, headAt, startMs) {
  if (base.wkg === null) return { ...base, windDelayMs: 0 };
  // En llano el reparto es constante: la escala sale de la velocidad sin viento.
  const scale = base.scale ?? base.movingMs / base.segs.reduce((a, s) => a + s.len / bikeSpeed(base.wkg, s.grade), 0);
  const durations = [];
  let elapsed = 0;
  for (const s of base.segs) {
    const mid = s.from + s.len / 2;
    const stopped = base.stops.reduce((a, st) => a + (mid > st.d ? st.ms : 0), 0);
    const head = headAt(mid, startMs + elapsed + stopped) || 0;
    const ms = (s.len / bikeSpeedWind(base.wkg, s.grade, head / 3.6)) * scale;
    durations.push(ms);
    elapsed += ms;
  }
  const profile = timeProfile(track, base.segs, durations, base.stops, { wkg: base.wkg, scale: base.scale });
  return { ...profile, windDelayMs: profile.movingMs - base.movingMs };
}
