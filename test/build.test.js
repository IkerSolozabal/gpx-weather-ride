import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { ENV_MAP, configFromEnv, configJs, cspMeta } from '../scripts/build-static.mjs';
import { DEFAULTS } from '../web/js/config.js';

test('las variables del build estático y del contenedor Docker son las mismas', async () => {
  const sh = await readFile(new URL('../docker/entrypoint/40-app-config.sh', import.meta.url), 'utf8');
  const fromShell = Object.fromEntries([...sh.matchAll(/^add\s+(\w+)\s+(\w+)/gm)].map((m) => [m[2], m[1]]));
  assert.deepEqual(fromShell, ENV_MAP);
  for (const key of Object.values(ENV_MAP)) assert.ok(key in DEFAULTS, `${key} no está en DEFAULTS`);
});

test('configFromEnv ignora vacíos y pone pro por defecto', () => {
  assert.deepEqual(configFromEnv({ APP_NAME: 'X', BIKE_SPEED_KMH: '', OTHER: 'y' }), { appName: 'X', appEnv: 'pro' });
  const js = configJs({ tileAttribution: '<a href="x">OSM</a>' });
  assert.match(js, /<\\\/a>/);
});

test('cspMeta permite el origen de la API de meteo', () => {
  assert.match(cspMeta({}), /connect-src 'self' https:\/\/api\.open-meteo\.com;/);
  assert.match(cspMeta({ WEATHER_API_URL: 'https://customer-api.open-meteo.com/v1/forecast', CSP_EXTRA_CONNECT: 'https://a.b' }), /connect-src 'self' https:\/\/customer-api\.open-meteo\.com https:\/\/a\.b;/);
});

test('SEO: canonical, og:url e imagen absolutos y sitemap con la URL del sitio', async () => {
  const { injectSeo, siteUrlFromEnv, sitemapXml } = await import('../scripts/build-static.mjs');
  assert.equal(siteUrlFromEnv({ PAGES_CNAME: 'gpx.sogra.es' }), 'https://gpx.sogra.es');
  assert.equal(siteUrlFromEnv({ SITE_URL: 'https://x.es/', PAGES_CNAME: 'y' }), 'https://x.es');
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const out = injectSeo(html, 'https://gpx.sogra.es');
  assert.match(out, /<link rel="canonical" href="https:\/\/gpx\.sogra\.es\/">/);
  assert.match(out, /og:image" content="https:\/\/gpx\.sogra\.es\/og-image\.png"/);
  assert.doesNotMatch(out, /seo:urls/);
  assert.equal(injectSeo(html, ''), html);
  assert.match(sitemapXml('https://gpx.sogra.es', new Date('2026-10-17')), /<loc>https:\/\/gpx\.sogra\.es\/<\/loc>[\s\S]*2026-10-17/);
});
