// Genera la web estática lista para publicar (GitHub Pages u otro hosting) en dist/.
//
//   npm install && node scripts/build-static.mjs
//
// Usa las mismas variables de entorno que el contenedor Docker (ver .env.pro.example):
// aquí se leen al compilar en lugar de al arrancar. En GitHub Actions llegan desde las
// "variables" del repositorio (Settings → Secrets and variables → Actions → Variables).

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Variable de entorno → clave de window.APP_CONFIG. Igual que docker/entrypoint/40-app-config.sh. */
export const ENV_MAP = {
  APP_ENV: 'appEnv',
  APP_NAME: 'appName',
  APP_VERSION: 'appVersion',
  APP_DEFAULT_LANG: 'defaultLang',
  WEATHER_API_URL: 'weatherApiUrl',
  WEATHER_API_KEY: 'weatherApiKey',
  WEATHER_MODELS: 'weatherModels',
  WEATHER_FORECAST_DAYS: 'forecastDays',
  MAP_TILE_URL: 'tileUrl',
  MAP_TILE_ATTRIBUTION: 'tileAttribution',
  MAP_MAX_ZOOM: 'tileMaxZoom',
  ROUTE_SAMPLE_KM: 'sampleKm',
  ROUTE_MAX_SAMPLES: 'maxSamples',
  ROUTE_SEGMENT_M: 'segmentM',
  GPX_MAX_FILE_MB: 'maxFileMb',
  DEFAULT_SPORT: 'defaultSport',
  BIKE_SPEED_KMH: 'bikeSpeedKmh',
  RUN_PACE: 'runPace',
  BIKE_MARKER_KM: 'bikeMarkerKm',
  RUN_MARKER_KM: 'runMarkerKm',
  WIND_CALM_KMH: 'calmKmh',
  WIND_HEAD_ANGLE: 'headAngle',
  WIND_TAIL_ANGLE: 'tailAngle',
};

const VENDOR_FILES = [
  ['node_modules/leaflet/dist/leaflet.js', 'vendor/leaflet/leaflet.js'],
  ['node_modules/leaflet/dist/leaflet.css', 'vendor/leaflet/leaflet.css'],
  ['node_modules/leaflet/dist/images', 'vendor/leaflet/images'],
  ...[400, 500, 600].map((w) => [`node_modules/@fontsource/barlow/files/barlow-latin-${w}-normal.woff2`, `vendor/fonts/barlow-latin-${w}-normal.woff2`]),
  ...[500, 600, 700].map((w) => [
    `node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-${w}-normal.woff2`,
    `vendor/fonts/barlow-condensed-latin-${w}-normal.woff2`,
  ]),
];

/** Objeto de configuración a partir de las variables de entorno (solo las que tienen valor). */
export function configFromEnv(env) {
  const cfg = {};
  for (const [name, key] of Object.entries(ENV_MAP)) {
    if (env[name] !== undefined && env[name] !== '') cfg[key] = String(env[name]);
  }
  if (!cfg.appEnv) cfg.appEnv = 'pro';
  return cfg;
}

export function configJs(cfg) {
  // Escapa "</" para que el valor no pueda cerrar una etiqueta <script>.
  const json = JSON.stringify(cfg, null, 2).replace(/<\//g, '<\\/');
  return `// Generado por scripts/build-static.mjs (${new Date().toISOString()}). No editar.\nwindow.APP_CONFIG = ${json};\n`;
}

/** Content-Security-Policy como <meta>, porque GitHub Pages no permite cabeceras propias. */
export function cspMeta(env) {
  const api = env.WEATHER_API_URL || 'https://api.open-meteo.com/v1/forecast';
  const connect = ["'self'", new URL(api).origin, ...(env.CSP_EXTRA_CONNECT || '').split(/\s+/).filter(Boolean)].join(' ');
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
}

async function build() {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const out = join(root, process.env.OUT_DIR || 'dist');
  const env = process.env;

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(join(root, 'web'), out, { recursive: true, filter: (src) => !src.includes(`${join('web', 'vendor')}`) });

  for (const [from, to] of VENDOR_FILES) {
    const src = join(root, from);
    if (!existsSync(src)) throw new Error(`Falta ${from}. Ejecuta antes: npm install`);
    await mkdir(join(out, to, '..'), { recursive: true });
    await cp(src, join(out, to), { recursive: true });
  }

  const cfg = configFromEnv(env);
  await writeFile(join(out, 'config.js'), configJs(cfg));

  const index = join(out, 'index.html');
  const html = await readFile(index, 'utf8');
  const robotsMeta = cfg.appEnv === 'pro' && env.ROBOTS_INDEX !== 'false' ? '' : '\n  <meta name="robots" content="noindex, nofollow">';
  await writeFile(index, html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  ${cspMeta(env)}${robotsMeta}`));

  const allow = cfg.appEnv === 'pro' && env.ROBOTS_INDEX !== 'false';
  await writeFile(join(out, 'robots.txt'), allow ? 'User-agent: *\nAllow: /\n' : 'User-agent: *\nDisallow: /\n');

  // Sin esto GitHub Pages procesa el sitio con Jekyll.
  await writeFile(join(out, '.nojekyll'), '');
  // Dominio propio para GitHub Pages (opcional; también se puede fijar en Settings → Pages).
  if (env.PAGES_CNAME) await writeFile(join(out, 'CNAME'), `${env.PAGES_CNAME}\n`);

  console.log(`Web generada en ${out} (entorno=${cfg.appEnv}, versión=${cfg.appVersion || 'sin versión'})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
