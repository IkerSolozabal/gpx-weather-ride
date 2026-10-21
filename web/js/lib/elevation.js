/**
 * Altitud para las rutas cuyo GPX no la trae, con la API de altitud de Open-Meteo
 * (modelo de terreno de 90 m, gratuita y en el mismo servidor que el pronóstico).
 * Sin altitud no hay ritmo por pendiente ni perfil.
 */

import { buildTrack, distanceSteps, pointAt } from './geo.js';

const PER_REQUEST = 100; // coordenadas por petición que admite la API

/** true si a algún punto le falta la altitud. */
export const needsElevation = (track) => track.points.some((p) => !Number.isFinite(p.ele));

/** URL de la API de altitud a partir de la del pronóstico: …/v1/forecast → …/v1/elevation. */
export function elevationUrlFor(weatherApiUrl) {
  const url = new URL(weatherApiUrl);
  url.pathname = url.pathname.replace(/[^/]*$/, 'elevation');
  url.search = '';
  return url.toString();
}

/** Puntos donde se pide la altitud: cada `minStepM` metros, como mucho `maxPoints`. */
export function elevationSamples(track, { maxPoints = 500, minStepM = 100 } = {}) {
  const step = Math.max(minStepM, track.total / (maxPoints - 1));
  return distanceSteps(track.total, step).map((d) => pointAt(track, d));
}

/**
 * Pide la altitud de los puntos en grupos de 100.
 * @returns {Promise<(number|null)[]>} Una altitud por punto, en el mismo orden.
 */
export async function fetchElevation(points, { url, apiKey }, fetchImpl = globalThis.fetch) {
  const chunks = [];
  for (let i = 0; i < points.length; i += PER_REQUEST) chunks.push(points.slice(i, i + PER_REQUEST));
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const u = new URL(url);
      u.searchParams.set('latitude', chunk.map((p) => p.lat.toFixed(5)).join(','));
      u.searchParams.set('longitude', chunk.map((p) => p.lon.toFixed(5)).join(','));
      if (apiKey) u.searchParams.set('apikey', apiKey);
      const res = await fetchImpl(u.toString());
      const body = await res.json();
      if (!res.ok || !Array.isArray(body?.elevation) || body.elevation.length !== chunk.length) throw new Error('elevation');
      return body.elevation.map((e) => (Number.isFinite(e) ? e : null));
    }),
  );
  return results.flat();
}

/**
 * La misma ruta con la altitud interpolada (por distancia) entre los puntos consultados.
 * Lleva `estimatedEle: true` para indicar que la altitud no venía en el GPX.
 */
export function withElevation(track, samples, elevations) {
  const known = samples.map((s, i) => ({ d: s.d, ele: elevations[i] })).filter((k) => Number.isFinite(k.ele));
  if (known.length < 2) return track;
  let j = 0;
  const points = track.points.map((p) => {
    while (j < known.length - 2 && known[j + 1].d <= p.d) j++;
    const a = known[j];
    const b = known[j + 1];
    const t = Math.max(0, Math.min(1, (p.d - a.d) / (b.d - a.d || 1)));
    return { lat: p.lat, lon: p.lon, ele: Math.round((a.ele + (b.ele - a.ele) * t) * 10) / 10 };
  });
  return { ...buildTrack(points), estimatedEle: true };
}
