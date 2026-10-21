/** Cliente de Open-Meteo (pronóstico horario) e interpolación temporal. */

export const HOURLY_VARS = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation_probability',
  'precipitation',
  'weather_code',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
];

export class WeatherError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.detail = detail || null;
  }
}

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const fix = (n, digits) => Number(n.toFixed(digits));

/**
 * Construye la URL de una petición para varios puntos a la vez.
 * @param {{lat:number, lon:number, ele?:number|null}[]} points
 * @param {{baseUrl:string, apiKey?:string, models?:string, startMs:number, endMs:number}} opts
 */
export function buildForecastUrl(points, opts) {
  const url = new URL(opts.baseUrl);
  const p = url.searchParams;
  p.set('latitude', points.map((x) => fix(x.lat, 4)).join(','));
  p.set('longitude', points.map((x) => fix(x.lon, 4)).join(','));
  // Con la altitud del GPX Open-Meteo corrige la temperatura; si falta alguna, usa su modelo de terreno.
  if (points.every((x) => Number.isFinite(x.ele))) {
    p.set('elevation', points.map((x) => Math.round(x.ele)).join(','));
  }
  p.set('hourly', HOURLY_VARS.join(','));
  p.set('daily', 'sunrise,sunset');
  p.set('wind_speed_unit', 'kmh');
  p.set('timezone', 'GMT');
  p.set('timeformat', 'unixtime');
  // Una hora de margen a cada lado para poder interpolar.
  p.set('start_date', ymd(opts.startMs - 3600_000));
  p.set('end_date', ymd(opts.endMs + 3600_000));
  if (opts.models) p.set('models', opts.models);
  if (opts.apiKey) p.set('apikey', opts.apiKey);
  return url.toString();
}

/** Convierte la respuesta de un punto en series con nombres cortos. */
export function toSeries(location) {
  const h = location.hourly;
  if (!h || !Array.isArray(h.time)) throw new WeatherError('bad_response');
  return {
    time: h.time.map((t) => t * 1000),
    temp: h.temperature_2m,
    feels: h.apparent_temperature,
    precipProb: h.precipitation_probability,
    precip: h.precipitation,
    code: h.weather_code,
    windSpeed: h.wind_speed_10m,
    windDir: h.wind_direction_10m,
    gusts: h.wind_gusts_10m,
    // Amanecer y anochecer de cada día (ms). Vacíos si la API no los devuelve.
    sunrise: (location.daily?.sunrise || []).map((t) => t * 1000),
    sunset: (location.daily?.sunset || []).map((t) => t * 1000),
  };
}

/**
 * Amanecer y anochecer (ms) del día en que cae el instante: el de mediodía solar más
 * cercano, así que la madrugada es del día que empieza y no del anterior.
 * null si no hay datos de ese día.
 */
export function sunTimes(series, tMs) {
  const { sunrise = [], sunset = [] } = series;
  let best = null;
  for (let i = 0; i < sunrise.length; i++) {
    const gap = Math.abs(tMs - (sunrise[i] + sunset[i]) / 2);
    if (gap < 12 * 3600_000 && (!best || gap < best.gap)) best = { gap, sunrise: sunrise[i], sunset: sunset[i] };
  }
  return best && { sunrise: best.sunrise, sunset: best.sunset };
}

/** true si el instante cae entre el amanecer y el anochecer; null si no hay datos de ese día. */
export function isDaylight(series, tMs) {
  const sun = sunTimes(series, tMs);
  return sun ? tMs >= sun.sunrise && tMs <= sun.sunset : null;
}

/**
 * Pide el pronóstico para todos los puntos, troceando en grupos de `chunkSize`.
 * @returns {Promise<object[]>} Una serie por punto, en el mismo orden.
 */
export async function fetchForecast(points, opts, fetchImpl = globalThis.fetch) {
  const chunkSize = opts.chunkSize || 50;
  const chunks = [];
  for (let i = 0; i < points.length; i += chunkSize) chunks.push(points.slice(i, i + chunkSize));

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      let res;
      try {
        res = await fetchImpl(buildForecastUrl(chunk, opts));
      } catch (err) {
        throw new WeatherError('network', err && err.message);
      }
      let body = null;
      try {
        body = await res.json();
      } catch {
        /* cuerpo vacío o no JSON */
      }
      if (!res.ok || !body || body.error) {
        const reason = body && body.reason ? body.reason : `HTTP ${res.status}`;
        if (res.status === 429) throw new WeatherError('rate_limit', reason);
        if (/out of allowed range/i.test(reason)) throw new WeatherError('out_of_range', reason);
        throw new WeatherError('api', reason);
      }
      const list = Array.isArray(body) ? body : [body];
      if (list.length !== chunk.length) throw new WeatherError('bad_response');
      return list.map(toSeries);
    }),
  );
  return results.flat();
}

const lerp = (a, b, t) => (a === null || b === null || a === undefined || b === undefined ? (t < 0.5 ? a : b) ?? null : a + (b - a) * t);

/**
 * Valores meteorológicos de una serie en un instante, interpolando entre horas.
 * La dirección del viento se interpola como vector para no pasar de 350° a 10° por 180°.
 * @returns {object|null} null si el instante queda fuera de la serie.
 */
export function weatherAt(series, tMs) {
  const { time } = series;
  if (!time.length || tMs < time[0] || tMs > time[time.length - 1]) return null;
  let i = 0;
  while (i < time.length - 2 && time[i + 1] <= tMs) i++;
  const span = time[i + 1] - time[i];
  const t = span > 0 ? Math.min(1, Math.max(0, (tMs - time[i]) / span)) : 0;
  const j = Math.min(i + 1, time.length - 1);
  const pick = (arr) => lerp(arr?.[i] ?? null, arr?.[j] ?? null, t);

  const s1 = series.windSpeed[i] ?? 0;
  const s2 = series.windSpeed[j] ?? 0;
  const d1 = ((series.windDir[i] ?? 0) * Math.PI) / 180;
  const d2 = ((series.windDir[j] ?? 0) * Math.PI) / 180;
  const u = lerp(s1 * Math.sin(d1), s2 * Math.sin(d2), t);
  const v = lerp(s1 * Math.cos(d1), s2 * Math.cos(d2), t);
  const windDir = ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360;

  return {
    temp: pick(series.temp),
    feels: pick(series.feels),
    precipProb: pick(series.precipProb),
    precip: pick(series.precip),
    code: t < 0.5 ? series.code[i] : series.code[j],
    windSpeed: pick(series.windSpeed),
    windDir,
    gusts: pick(series.gusts),
  };
}
