import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseGpx, GpxError } from '../web/js/lib/gpx.js';
import { angleDiff, bearing, bearingAround, buildTrack, distanceSteps, elevationStats, haversine, pointAt } from '../web/js/lib/geo.js';
import { formatDuration, formatPace, makeClock, parsePace, paceToKmh } from '../web/js/lib/timing.js';
import { compass, relativeWind, windSide, WIND } from '../web/js/lib/wind.js';
import { buildForecastUrl, fetchForecast, weatherAt, toSeries, WeatherError } from '../web/js/lib/weather.js';
import { computePlan } from '../web/js/lib/plan.js';
import { fakeFetch, fakeLocation, straightLine, toGpx } from './helpers.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} esperado ${b}±${tol}, obtenido ${a}`);

// --- GPX ---------------------------------------------------------------

test('parseGpx lee trkpt con altitud y nombre', () => {
  const gpx = parseGpx(toGpx(straightLine({ km: 1 }), { name: 'Vuelta &amp; café' }));
  assert.equal(gpx.name, 'Vuelta & café');
  assert.equal(gpx.points.length, 11);
  assert.equal(gpx.points[0].ele, 50);
});

test('parseGpx usa rtept si no hay track y admite atributos en otro orden y prefijos', () => {
  const gpx = parseGpx(toGpx(straightLine({ km: 1 }), { tag: 'rtept' }));
  assert.equal(gpx.points.length, 11);
  const odd = `<gpx:gpx xmlns:gpx="x"><gpx:trk><gpx:trkseg>
    <gpx:trkpt lon='-2.9' lat='43.2'/>
    <gpx:trkpt lon="-2.91" lat="43.21"><gpx:ele>12.5</gpx:ele></gpx:trkpt>
  </gpx:trkseg></gpx:trk></gpx:gpx>`;
  const p = parseGpx(odd).points;
  assert.deepEqual(p[0], { lat: 43.2, lon: -2.9, ele: null });
  assert.equal(p[1].ele, 12.5);
});

test('parseGpx rechaza archivos que no son GPX o sin puntos', () => {
  assert.throws(() => parseGpx('hola'), (e) => e instanceof GpxError && e.code === 'not_gpx');
  assert.throws(() => parseGpx('<gpx><trk></trk></gpx>'), (e) => e.code === 'no_points');
});

// --- Geo ---------------------------------------------------------------

test('haversine: 1° de latitud ≈ 111,2 km', () => {
  near(haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }), 111195, 50);
});

test('bearing en los cuatro puntos cardinales', () => {
  near(bearing({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }), 0, 0.01);
  near(bearing({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }), 90, 0.01);
  near(bearing({ lat: 1, lon: 0 }, { lat: 0, lon: 0 }), 180, 0.01);
  near(bearing({ lat: 0, lon: 1 }, { lat: 0, lon: 0 }), 270, 0.01);
  assert.equal(angleDiff(350, 10), 20);
  assert.equal(angleDiff(0, 180), 180);
});

test('buildTrack acumula distancia, quita duplicados e interpola', () => {
  const pts = straightLine({ km: 10, bearingDeg: 90 });
  pts.splice(5, 0, { ...pts[5] }); // duplicado
  const track = buildTrack(pts);
  assert.equal(track.points.length, 101);
  near(track.total, 10000, 15);
  const mid = pointAt(track, 5000);
  near(mid.d, 5000, 0.001);
  near(haversine(track.points[0], mid), 5000, 10);
  near(bearingAround(track, 5000), 90, 0.5);
});

test('distanceSteps incluye el final y no deja un último tramo diminuto', () => {
  assert.deepEqual(distanceSteps(10, 3), [0, 3, 6, 9, 10]);
  assert.deepEqual(distanceSteps(9.5, 3), [0, 3, 6, 9.5]);
});

test('elevationStats ignora el ruido por debajo del umbral', () => {
  const pts = straightLine({ km: 1 }).map((p, i) => ({ ...p, ele: 100 + (i % 2) + (i >= 5 ? 50 : 0) }));
  const s = elevationStats(buildTrack(pts));
  near(s.gain, 50, 1.01);
  assert.equal(elevationStats(buildTrack(straightLine({ km: 1, ele: null }))), null);
});

// --- Tiempos ------------------------------------------------------------

test('ritmo y velocidad', () => {
  assert.equal(parsePace('5:30'), 330);
  assert.equal(parsePace('4,5'), 270);
  assert.equal(parsePace('abc'), null);
  assert.equal(parsePace('0:00'), null);
  assert.equal(formatPace(330), '5:30');
  near(paceToKmh(300), 12, 1e-9);
  const clock = makeClock(0, 30);
  assert.equal(clock(30000), 3600_000);
  assert.equal(formatDuration(5_400_000), '1:30');
});

// --- Viento -------------------------------------------------------------

test('relativeWind clasifica en contra, a favor, lateral y calma', () => {
  // Vas al norte (0°) y el viento viene del norte → en contra.
  assert.equal(relativeWind(0, 0, 20).category, WIND.HEAD);
  near(relativeWind(0, 0, 20).head, 20, 1e-9);
  // Viento del sur → a favor, componente negativa.
  const tail = relativeWind(0, 180, 20);
  assert.equal(tail.category, WIND.TAIL);
  near(tail.head, -20, 1e-9);
  assert.equal(relativeWind(0, 90, 20).category, WIND.CROSS);
  assert.equal(relativeWind(0, 0, 2).category, WIND.CALM);
  assert.equal(relativeWind(350, 20, 20).category, WIND.HEAD); // cruza el 0°
  assert.equal(windSide(0, 90), 'right');
  assert.equal(windSide(0, 270), 'left');
  assert.equal(compass(225), 'SO');
  assert.equal(compass(225, 'en'), 'SW');
});

// --- Meteo ----------------------------------------------------------------

test('buildForecastUrl pide varios puntos, altitud y el rango de fechas', () => {
  const url = new URL(
    buildForecastUrl([{ lat: 43.123456, lon: -2.5, ele: 100.4 }, { lat: 43.2, lon: -2.6, ele: 200 }], {
      baseUrl: 'https://api.open-meteo.com/v1/forecast',
      startMs: Date.parse('2026-10-17T07:30:00Z'),
      endMs: Date.parse('2026-10-17T23:30:00Z'),
      apiKey: 'k',
    }),
  );
  assert.equal(url.searchParams.get('latitude'), '43.1235,43.2');
  assert.equal(url.searchParams.get('elevation'), '100,200');
  assert.equal(url.searchParams.get('start_date'), '2026-10-17');
  assert.equal(url.searchParams.get('end_date'), '2026-10-18');
  assert.equal(url.searchParams.get('timeformat'), 'unixtime');
  assert.equal(url.searchParams.get('apikey'), 'k');
  const noEle = new URL(buildForecastUrl([{ lat: 1, lon: 2, ele: null }], { baseUrl: 'https://x/y', startMs: 0, endMs: 0 }));
  assert.equal(noEle.searchParams.has('elevation'), false);
});

test('weatherAt interpola valores y la dirección del viento como vector', () => {
  const s = toSeries(fakeLocation(0, 3, { temp: (i) => 10 + i * 2, windDir: (i) => [350, 10, 10][i], windSpeed: 10 }));
  const w = weatherAt(s, 1800_000);
  near(w.temp, 11, 1e-9);
  near(angleDiff(w.windDir, 0), 0, 0.01); // entre 350° y 10° → 0°, no 180°
  assert.equal(weatherAt(s, 4 * 3600_000), null);
});

test('fetchForecast trocea las peticiones y traduce errores', async () => {
  const calls = [];
  const pts = Array.from({ length: 120 }, (_, i) => ({ lat: 43 + i / 1000, lon: -2, ele: 0 }));
  const series = await fetchForecast(pts, { baseUrl: 'https://x/v1/forecast', startMs: 0, endMs: 3600_000, chunkSize: 50 }, fakeFetch(fakeLocation, calls));
  assert.equal(calls.length, 3);
  assert.equal(series.length, 120);

  const failing = async () => ({ ok: false, status: 400, json: async () => ({ error: true, reason: "Parameter 'start_date' is out of allowed range" }) });
  await assert.rejects(
    fetchForecast(pts.slice(0, 2), { baseUrl: 'https://x/', startMs: 0, endMs: 0 }, failing),
    (e) => e instanceof WeatherError && e.code === 'out_of_range',
  );
  const limited = async () => ({ ok: false, status: 429, json: async () => ({ error: true, reason: 'Too many' }) });
  await assert.rejects(fetchForecast(pts.slice(0, 1), { baseUrl: 'https://x/', startMs: 0, endMs: 0 }, limited), (e) => e.code === 'rate_limit');
});

// --- Plan completo -----------------------------------------------------------

test('computePlan: ida al norte con viento del norte es todo en contra', async () => {
  const track = buildTrack(straightLine({ km: 30, bearingDeg: 0 }));
  const startMs = Date.parse('2026-10-17T08:00:00Z');
  const plan = await computePlan(
    track,
    { startMs, speedKmh: 30, sampleKm: 5, markerKm: 5, segmentM: 250, weather: { baseUrl: 'https://x/v1/forecast' } },
    fakeFetch((s, h) => fakeLocation(s, h, { windDir: 0, windSpeed: 20 })),
  );
  near(plan.endMs - startMs, 3600_000, 10_000);
  assert.equal(plan.markers.length, 7); // 0,5,…,30
  near(plan.markers[2].time - startMs, 20 * 60_000, 200); // km 10 a los 20 min
  near(plan.summary.share.head, 1, 1e-9);
  assert.ok(plan.segments.every((s) => s.category === WIND.HEAD));
  assert.equal(plan.missingWeather, false);
});

test('computePlan: ida y vuelta reparte contra y a favor y sigue la temperatura en el tiempo', async () => {
  const out = straightLine({ km: 10, bearingDeg: 90 });
  const back = [...out].reverse().slice(1);
  const track = buildTrack([...out, ...back]);
  const startMs = Date.parse('2026-10-17T08:00:00Z');
  const plan = await computePlan(
    track,
    { startMs, speedKmh: 20, sampleKm: 2, markerKm: 1, weather: { baseUrl: 'https://x/v1/forecast' } },
    // Viento del este; la temperatura sube 1 °C por hora desde las 00:00 UTC.
    fakeFetch((s, h) => fakeLocation(s, h, { windDir: 90, windSpeed: 25, temp: (i) => i })),
  );
  near(plan.summary.share.head, 0.5, 0.03);
  near(plan.summary.share.tail, 0.5, 0.03);
  // Llegada a las 09:00 UTC → 9 °C; salida 8 °C.
  near(plan.markers[0].weather.temp, 8, 0.01);
  near(plan.markers[plan.markers.length - 1].weather.temp, 9, 0.05);
});
