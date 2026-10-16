/**
 * Configuración en tiempo de ejecución. Los valores llegan desde /config.js
 * (generado por el contenedor a partir de variables de entorno) y se completan
 * con estos valores por defecto.
 */

export const DEFAULTS = Object.freeze({
  appEnv: 'pro', // pro | pre | dev
  appName: 'GPX Weather Ride',
  defaultLang: 'es',

  weatherApiUrl: 'https://api.open-meteo.com/v1/forecast',
  weatherApiKey: '',
  weatherModels: '',
  forecastDays: 16,

  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  tileMaxZoom: 19,

  sampleKm: 2,
  maxSamples: 150,
  segmentM: 250,

  defaultSport: 'bike',
  bikeSpeedKmh: 25,
  runPace: '5:30',
  bikeMarkerKm: 5,
  runMarkerKm: 1,

  calmKmh: 5,
  headAngle: 45,
  tailAngle: 135,

  maxFileMb: 10,
});

const NUMERIC = Object.keys(DEFAULTS).filter((k) => typeof DEFAULTS[k] === 'number');

export function loadConfig(raw = globalThis.window?.APP_CONFIG || {}) {
  const cfg = { ...DEFAULTS };
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in DEFAULTS) || value === '' || value === null || value === undefined) continue;
    if (NUMERIC.includes(key)) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) cfg[key] = n;
    } else {
      cfg[key] = String(value);
    }
  }
  if (!['bike', 'run'].includes(cfg.defaultSport)) cfg.defaultSport = DEFAULTS.defaultSport;
  if (!['es', 'en'].includes(cfg.defaultLang)) cfg.defaultLang = DEFAULTS.defaultLang;
  return Object.freeze(cfg);
}
