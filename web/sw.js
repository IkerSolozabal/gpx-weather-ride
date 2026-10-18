/* Service worker de GPX Weather Ride: permite instalar la app y usarla sin conexión.
 *
 * - Archivos de la web (HTML, JS, CSS, Leaflet, fuentes): primero la red, para ver
 *   siempre la última versión, y si no hay conexión, la copia guardada.
 * - Pronóstico de Open-Meteo: primero la red; sin conexión, la última respuesta
 *   guardada para esa misma ruta y día.
 * - Teselas del mapa: primero la copia guardada (cambian poco) y, si no está, la red.
 *
 * Al añadir un archivo a web/, añádelo también a PRECACHE (lo comprueba test/pwa.test.js).
 */

const VERSION = 'v1';
const SHELL = `gwr-shell-${VERSION}`;
const WEATHER = 'gwr-weather';
const TILES = 'gwr-tiles';
const MAX_WEATHER = 30;
const MAX_TILES = 600;

// Rutas relativas a la ubicación de sw.js (funciona en la raíz o en una subcarpeta).
const PRECACHE = [
  './',
  './index.html',
  './app/',
  './app/index.html',
  './404.html',
  './config.js',
  './manifest.webmanifest',
  './favicon.svg',
  './apple-touch-icon.png',
  './og-image.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './css/base.css',
  './css/app.css',
  './css/landing.css',
  './js/app.js',
  './js/config.js',
  './js/i18n.js',
  './js/landing.js',
  './js/leaflet-fallback.js',
  './js/pwa.js',
  './js/lib/beststart.js',
  './js/lib/clock.js',
  './js/lib/geo.js',
  './js/lib/gpx-export.js',
  './js/lib/gpx.js',
  './js/lib/plan.js',
  './js/lib/recent.js',
  './js/lib/share.js',
  './js/lib/tiles.js',
  './js/lib/timing.js',
  './js/lib/weather.js',
  './js/lib/wind.js',
  './js/ui/export-image.js',
  './js/ui/format.js',
  './js/ui/map.js',
  './js/ui/profile.js',
  './js/ui/start-picker.js',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png',
  './vendor/fonts/barlow-latin-400-normal.woff2',
  './vendor/fonts/barlow-latin-500-normal.woff2',
  './vendor/fonts/barlow-latin-600-normal.woff2',
  './vendor/fonts/barlow-condensed-latin-500-normal.woff2',
  './vendor/fonts/barlow-condensed-latin-600-normal.woff2',
  './vendor/fonts/barlow-condensed-latin-700-normal.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) =>
      // Uno a uno: si falta algún archivo (p. ej. las fuentes en desarrollo), no se pierde el resto.
      Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => null))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('gwr-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function networkFirst(request, cacheName, { fallbackUrl, max } = {}) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      if (max) trim(cacheName, max);
    }
    return response;
  } catch (err) {
    const cached = (await cache.match(request, { ignoreSearch: request.mode === 'navigate' })) || (fallbackUrl && (await caches.match(fallbackUrl)));
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // Las teselas pedidas sin CORS llegan "opaque" (status 0): también sirven para el mapa.
  if (response.ok || response.type === 'opaque') {
    await cache.put(request, response.clone());
    trim(cacheName, max);
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    const fallbackUrl = request.mode === 'navigate' ? new URL(url.pathname.includes('/app/') ? './app/' : './', self.location).href : undefined;
    event.respondWith(networkFirst(request, SHELL, { fallbackUrl }));
    return;
  }
  if (/open-meteo\.com$/.test(url.hostname)) {
    event.respondWith(networkFirst(request, WEATHER, { max: MAX_WEATHER }));
    return;
  }
  // Solo las teselas que pide el mapa (sin CORS). Las de la imagen exportada piden CORS y van directas a la red.
  if (request.mode === 'no-cors' && request.destination === 'image' && /tile/i.test(url.hostname + url.pathname)) {
    event.respondWith(cacheFirst(request, TILES, MAX_TILES));
  }
});
