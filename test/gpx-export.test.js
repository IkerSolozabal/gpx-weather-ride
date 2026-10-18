import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTrack } from '../web/js/lib/geo.js';
import { parseGpx } from '../web/js/lib/gpx.js';
import { computePlan } from '../web/js/lib/plan.js';
import { alertsFor, buildGpx, fileName } from '../web/js/lib/gpx-export.js';
import { fakeFetch, fakeLocation, straightLine } from './helpers.js';

test('buildGpx genera un GPX válido con el track y un waypoint por punto kilométrico', async () => {
  const track = buildTrack(straightLine({ km: 20, bearingDeg: 0 }));
  const plan = await computePlan(
    track,
    { startMs: Date.parse('2026-10-18T08:00:00Z'), speedKmh: 20, sampleKm: 5, markerKm: 5, weather: { baseUrl: 'https://x/v1/forecast' } },
    // Viento del norte de 25 km/h (en contra) y 60 % de lluvia a partir de las 09:00.
    fakeFetch((s, h) => fakeLocation(s, h, { windDir: 0, windSpeed: 25, precipProb: (i) => (i % 24 >= 9 ? 60 : 0) })),
  );
  const gpx = buildGpx({ track, plan, name: 'Ruta <prueba> & co', label: (m, a) => ({ name: `km ${Math.round(m.d / 1000)}${a.length ? ' !' : ''}`, desc: a.join(',') }) });
  const parsed = parseGpx(gpx);
  assert.equal(parsed.name, 'Ruta <prueba> & co');
  assert.equal(parsed.points.length, track.points.length);
  const wpts = [...gpx.matchAll(/<wpt /g)].length;
  assert.equal(wpts, plan.markers.length);
  assert.match(gpx, /<time>2026-10-18T08:00:00Z<\/time><name>km 0 !<\/name><desc>head<\/desc>/);
  assert.match(gpx, /<name>km 20 !<\/name><desc>rain,head<\/desc>/);
  assert.match(gpx, /Danger Area/);
});

test('alertsFor no avisa con buen tiempo', () => {
  assert.deepEqual(alertsFor({ weather: { precipProb: 10, gusts: 20 }, rel: { head: -5 } }), []);
  assert.deepEqual(alertsFor({ weather: null }), []);
});

test('fileName quita acentos y caracteres raros', () => {
  assert.equal(fileName('Vuelta por el Txorierri y Artxanda (sentido contrario)', 'png'), 'vuelta-por-el-txorierri-y-artxanda-sentido-contrario.png');
  assert.equal(fileName('', 'gpx'), 'ruta.gpx');
});
