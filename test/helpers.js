/** Utilidades para los tests: GPX sintéticos y respuestas falsas de Open-Meteo. */

/** Punto a `meters` de (lat, lon) en dirección `bearingDeg` (aproximación local). */
export function offset(lat, lon, meters, bearingDeg) {
  const b = (bearingDeg * Math.PI) / 180;
  const dLat = (meters * Math.cos(b)) / 111320;
  const dLon = (meters * Math.sin(b)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lon: lon + dLon };
}

/** Línea recta de `km` kilómetros hacia `bearingDeg`, con un punto cada `stepM` metros. */
export function straightLine({ lat = 43.26, lon = -2.93, km = 10, bearingDeg = 0, stepM = 100, ele = 50 } = {}) {
  const pts = [];
  for (let m = 0; m <= km * 1000 + 1e-6; m += stepM) {
    const p = offset(lat, lon, m, bearingDeg);
    pts.push({ ...p, ele });
  }
  return pts;
}

export function toGpx(points, { name = 'Test', tag = 'trkpt' } = {}) {
  const body = points
    .map((p) => `<${tag} lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${p.ele !== null && p.ele !== undefined ? `<ele>${p.ele}</ele>` : ''}</${tag}>`)
    .join('\n');
  const wrap = tag === 'trkpt' ? `<trk><name>${name}</name><trkseg>${body}</trkseg></trk>` : `<rte><name>${name}</name>${body}</rte>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">${wrap}</gpx>`;
}

/**
 * Serie horaria constante (o generada por funciones) en formato de Open-Meteo.
 * @param {number} startSec Primer instante (unix s).
 * @param {number} hours Número de horas.
 */
export function fakeLocation(startSec, hours, { temp = 15, windSpeed = 20, windDir = 0, gusts = 30, precipProb = 10 } = {}) {
  const at = (v, i) => (typeof v === 'function' ? v(i) : v);
  const time = Array.from({ length: hours }, (_, i) => startSec + i * 3600);
  return {
    hourly: {
      time,
      temperature_2m: time.map((_, i) => at(temp, i)),
      apparent_temperature: time.map((_, i) => at(temp, i) - 2),
      precipitation_probability: time.map((_, i) => at(precipProb, i)),
      precipitation: time.map(() => 0),
      weather_code: time.map(() => 1),
      wind_speed_10m: time.map((_, i) => at(windSpeed, i)),
      wind_direction_10m: time.map((_, i) => at(windDir, i)),
      wind_gusts_10m: time.map((_, i) => at(gusts, i)),
    },
  };
}

/** fetch falso que responde con una ubicación por cada coordenada pedida. */
export function fakeFetch(makeLocation, calls = []) {
  return async (url) => {
    calls.push(url);
    const u = new URL(url);
    const n = u.searchParams.get('latitude').split(',').length;
    const start = Date.parse(`${u.searchParams.get('start_date')}T00:00:00Z`) / 1000;
    const end = Date.parse(`${u.searchParams.get('end_date')}T00:00:00Z`) / 1000 + 86400;
    const hours = (end - start) / 3600;
    const list = Array.from({ length: n }, (_, i) => makeLocation(start, hours, i));
    return { ok: true, status: 200, json: async () => (n === 1 ? list[0] : list) };
  };
}
