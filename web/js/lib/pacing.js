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
 * Tiempo de paso según la distancia, con la pendiente y las paradas.
 * @param {object} track Resultado de buildTrack.
 * @param {{sport: 'bike'|'run', speedKmh: number, stopMin?: number, stepM?: number}} opts
 * @returns {{offset: (d:number) => number, movingMs: number, stopMs: number, totalMs: number, stopAt: number, wkg: number|null}}
 *   offset(d): ms desde la salida hasta pasar por la distancia d. Las paradas se cuentan a mitad de ruta.
 */
export function paceProfile(track, { sport, speedKmh, stopMin = 0, stepM = 200 }) {
  if (!(speedKmh > 0)) throw new Error('speed must be > 0');
  const movingMs = (track.total / 1000 / speedKmh) * 3600_000;
  const segs = track.total > 0 ? gradeProfile(track, stepM) : [];
  const flat = segs.every((s) => s.grade === 0);

  let wkg = null;
  let weights; // tiempo relativo de cada tramo
  if (flat) weights = segs.map((s) => s.len);
  else if (sport === 'run') weights = segs.map((s) => s.len * runCost(s.grade));
  else {
    wkg = bikeLevel(segs, movingMs / 1000);
    weights = segs.map((s) => s.len / bikeSpeed(wkg, s.grade));
  }
  // Se escala para que el total sea exactamente distancia ÷ media.
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const cum = [0];
  for (const w of weights) cum.push(cum[cum.length - 1] + (w / sum) * movingMs);

  const stopMs = Math.max(0, stopMin || 0) * 60_000;
  const stopAt = track.total / 2;

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

  return {
    offset: (d) => moving(d) + (stopMs && d > stopAt ? stopMs : 0),
    movingMs,
    stopMs,
    totalMs: movingMs + stopMs,
    stopAt,
    wkg,
  };
}
