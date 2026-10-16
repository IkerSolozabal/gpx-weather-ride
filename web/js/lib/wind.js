/** Viento relativo a la dirección de marcha. */

import { angleDiff, norm360 } from './geo.js';

export const WIND = Object.freeze({ HEAD: 'head', TAIL: 'tail', CROSS: 'cross', CALM: 'calm' });

/**
 * @param {number} courseDeg Rumbo de marcha (hacia dónde vas), grados.
 * @param {number} windFromDeg Dirección meteorológica del viento (de dónde viene), grados.
 * @param {number} speed Velocidad del viento (cualquier unidad).
 * @param {{calm?: number, headAngle?: number, tailAngle?: number}} [opts]
 *   calm: por debajo de esta velocidad se considera calma.
 *   headAngle: ángulo máximo (respecto a de frente) para contar como viento en contra.
 *   tailAngle: ángulo mínimo para contar como viento a favor.
 * @returns {{angle:number, head:number, cross:number, category:string}}
 *   angle 0 = de frente, 180 = por detrás. head > 0 = en contra, < 0 = a favor.
 */
export function relativeWind(courseDeg, windFromDeg, speed, opts = {}) {
  const { calm = 5, headAngle = 45, tailAngle = 135 } = opts;
  const angle = angleDiff(windFromDeg, courseDeg);
  const head = speed * Math.cos((angle * Math.PI) / 180);
  const cross = speed * Math.sin((angle * Math.PI) / 180);
  let category;
  if (speed < calm) category = WIND.CALM;
  else if (angle <= headAngle) category = WIND.HEAD;
  else if (angle >= tailAngle) category = WIND.TAIL;
  else category = WIND.CROSS;
  return { angle, head, cross, category };
}

/** Lado por el que entra el viento lateral: 'left' o 'right'. */
export function windSide(courseDeg, windFromDeg) {
  const rel = norm360(windFromDeg - courseDeg);
  return rel > 0 && rel < 180 ? 'right' : 'left';
}

const POINTS_ES = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
const POINTS_EN = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Grados → punto cardinal de 16 rumbos. */
export function compass(deg, lang = 'es') {
  const list = lang === 'en' ? POINTS_EN : POINTS_ES;
  return list[Math.round(norm360(deg) / 22.5) % 16];
}
