import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTrack, haversine } from '../web/js/lib/geo.js';
import { parseGpx } from '../web/js/lib/gpx.js';
import {
  decodeInts, decodePolyline, decodeShare, encodeInts, encodePolyline, encodeShare, maxDeviation, ShareError, simplify, trimEnds,
} from '../web/js/lib/share.js';
import { offset, straightLine } from './helpers.js';

/** Ruta sinuosa de ~60 km con altitud, con un punto cada ~20 m (unos 3.000 puntos). */
function wigglyRoute() {
  const pts = [];
  let p = { lat: 43.2, lon: -2.9 };
  for (let i = 0; i < 3000; i++) {
    const bearing = 40 + 70 * Math.sin(i / 90) + 25 * Math.sin(i / 13);
    p = offset(p.lat, p.lon, 20, bearing);
    pts.push({ ...p, ele: 100 + 300 * Math.sin(i / 600) + 5 * Math.sin(i / 7) });
  }
  return pts;
}

test('polilínea y enteros: ida y vuelta', () => {
  const pts = [{ lat: 38.5, lon: -120.2 }, { lat: 40.7, lon: -120.95 }, { lat: 43.252, lon: -126.453 }];
  assert.equal(encodePolyline(pts), '_p~iF~ps|U_ulLnnqC_mqNvxq`@'); // ejemplo de la documentación de Google
  assert.deepEqual(decodePolyline(encodePolyline(pts)), pts);
  assert.deepEqual(decodeInts(encodeInts([120, 118, 300, -5, 0])), [120, 118, 300, -5, 0]);
});

test('simplify reduce puntos sin alejarse más de la tolerancia', () => {
  const pts = wigglyRoute();
  const s = simplify(pts, 10);
  assert.ok(s.length < pts.length / 3, `${s.length} puntos`);
  assert.ok(maxDeviation(pts.filter((_, i) => i % 25 === 0), s) <= 10.5);
  assert.deepEqual(simplify(straightLine({ km: 5 }), 1).length, 2);
});

test('trimEnds quita 500 m al principio y al final, salvo en rutas cortas', () => {
  const track = buildTrack(straightLine({ km: 10 }));
  const cut = trimEnds(track, 500);
  assert.ok(Math.abs(haversine(track.points[0], cut[0]) - 500) < 2);
  assert.ok(Math.abs(haversine(track.points.at(-1), cut.at(-1)) - 500) < 2);
  const short = buildTrack(straightLine({ km: 1.5 }));
  assert.equal(trimEnds(short, 500).length, short.points.length);
  assert.equal(trimEnds(track, 0).length, track.points.length);
});

test('encodeShare/decodeShare: ida y vuelta con nombre, salida, deporte y velocidad', async () => {
  const track = buildTrack(wigglyRoute());
  const { hash } = await encodeShare(track, { name: 'Vuelta & café', startMs: Date.parse('2026-10-18T07:30:00Z'), sport: 'bike', speedKmh: 27.5, stopMin: 25 });
  assert.ok(hash.startsWith('r='));
  assert.ok(hash.length < 7000, `longitud ${hash.length}`);
  const out = await decodeShare(`#${hash}`);
  assert.equal(out.name, 'Vuelta & café');
  assert.equal(out.startMs, Date.parse('2026-10-18T07:30:00Z'));
  assert.equal(out.sport, 'bike');
  assert.equal(out.speedKmh, 27.5);
  assert.equal(out.stopMin, 25);
  assert.ok(Number.isInteger(out.points[0].ele));
  const shared = buildTrack(out.points);
  // Distancia muy parecida: la original menos 1 km recortado, con margen por la simplificación.
  assert.ok(Math.abs(shared.total - (track.total - 1000)) < track.total * 0.01, `${shared.total} vs ${track.total}`);
});

test('una ruta muy larga se simplifica más hasta caber en el enlace', async () => {
  const pts = [];
  let p = { lat: 42, lon: -3 };
  for (let i = 0; i < 20000; i++) {
    p = offset(p.lat, p.lon, 15, 360 * Math.sin(i / 40));
    pts.push({ ...p, ele: 500 + 200 * Math.sin(i / 50) });
  }
  const { hash, tolerance } = await encodeShare(buildTrack(pts), { maxLength: 5000 });
  assert.ok(hash.length <= 5000);
  assert.ok(tolerance > 5);
});

test('decodeShare: sin ruta devuelve null y un enlace roto da error', async () => {
  assert.equal(await decodeShare(''), null);
  assert.equal(await decodeShare('#foo=1'), null);
  await assert.rejects(decodeShare('#r=esto-no-es-valido'), (e) => e instanceof ShareError && e.code === 'bad_link');
});

test('el GPX de ejemplo de los tests sobrevive al enlace sin altitud', async () => {
  const gpx = parseGpx(`<gpx><trk><trkseg>${straightLine({ km: 8, ele: null }).map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}"/>`).join('')}</trkseg></trk></gpx>`);
  const { hash } = await encodeShare(buildTrack(gpx.points), { hideMeters: 0 });
  const out = await decodeShare(hash);
  assert.equal(out.points[0].ele, null);
  assert.equal(out.sport, null);
});
