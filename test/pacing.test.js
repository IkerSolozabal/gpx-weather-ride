import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTrack } from '../web/js/lib/geo.js';
import { bikeSpeed, gradeProfile, paceProfile, runCost } from '../web/js/lib/pacing.js';
import { straightLine } from './helpers.js';

/** 10 km llanos, 10 km de puerto al 7 % y 10 km de bajada. */
function climbRoute() {
  const pts = straightLine({ km: 30, stepM: 100 }).map((p, i) => {
    const m = i * 100;
    const ele = m <= 10000 ? 100 : m <= 20000 ? 100 + (m - 10000) * 0.07 : 800 - (m - 20000) * 0.07;
    return { ...p, ele };
  });
  return buildTrack(pts);
}
const min = (ms) => ms / 60000;

test('el tiempo total sigue siendo distancia ÷ media, más las paradas', () => {
  const track = climbRoute();
  const p = paceProfile(track, { sport: 'bike', speedKmh: 24, stopMin: 20 });
  const expected = (track.total / 1000 / 24) * 3600_000;
  assert.ok(Math.abs(p.movingMs - expected) < 1);
  assert.ok(Math.abs(p.offset(track.total) - (expected + 20 * 60_000)) < 1);
  assert.equal(p.offset(0), 0);
});

test('en bici se sube más despacio y se baja más deprisa', () => {
  const track = climbRoute();
  const p = paceProfile(track, { sport: 'bike', speedKmh: 24 });
  const flat = p.offset(10000);
  const climb = p.offset(20000) - p.offset(10000);
  const descent = p.offset(track.total) - p.offset(20000);
  assert.ok(climb > flat * 2, `puerto ${min(climb)} min, llano ${min(flat)} min`);
  assert.ok(descent < flat);
});

test('con más media se deduce más nivel y el puerto se sube bastante más rápido', () => {
  const track = climbRoute();
  const slow = paceProfile(track, { sport: 'bike', speedKmh: 22 });
  const fast = paceProfile(track, { sport: 'bike', speedKmh: 26 });
  assert.ok(fast.wkg > slow.wkg);
  const climb = (p) => min(p.offset(20000) - p.offset(10000));
  const flat = (p) => min(p.offset(10000));
  // 10 km al 7 %: ~10 minutos de diferencia; en llano, apenas un par.
  assert.ok(climb(slow) - climb(fast) > 8, `${climb(slow)} vs ${climb(fast)}`);
  assert.ok(flat(slow) - flat(fast) < 3);
});

test('la misma media en una ruta más dura indica más nivel', () => {
  const hilly = paceProfile(climbRoute(), { sport: 'bike', speedKmh: 24 });
  const flat = paceProfile(buildTrack(straightLine({ km: 30, stepM: 100, ele: 100 })), { sport: 'bike', speedKmh: 24 });
  assert.equal(flat.wkg, null); // en llano no hace falta: velocidad constante
  const hillyFlatKmh = 10 / (hilly.offset(10000) / 3600_000);
  assert.ok(hillyFlatKmh > 24, `en el llano de la ruta dura va a ${hillyFlatKmh.toFixed(1)} km/h`);
});

test('sin altitudes la velocidad es constante', () => {
  const track = buildTrack(straightLine({ km: 10 }).map((p) => ({ ...p, ele: null })));
  const p = paceProfile(track, { sport: 'run', speedKmh: 10 });
  assert.ok(Math.abs(p.offset(5000) - 30 * 60_000) < 1);
});

test('corriendo: la subida cuesta más que el llano y la bajada suave menos', () => {
  assert.equal(runCost(0), 3.6);
  assert.ok(runCost(0.1) > 3.6 * 1.5);
  assert.ok(runCost(-0.1) < 3.6);
  const p = paceProfile(climbRoute(), { sport: 'run', speedKmh: 10 });
  assert.ok(p.offset(20000) - p.offset(10000) > p.offset(10000));
});

test('bikeSpeed respeta los límites y gradeProfile recorta pendientes absurdas', () => {
  assert.ok(Math.abs(bikeSpeed(3, -0.2) * 3.6 - 45) < 0.01);
  assert.ok(bikeSpeed(0.5, 0.25) * 3.6 >= 4 - 1e-9);
  const spike = buildTrack(straightLine({ km: 1, stepM: 100 }).map((p, i) => ({ ...p, ele: i === 5 ? 500 : 0 })));
  assert.ok(gradeProfile(spike).every((s) => Math.abs(s.grade) <= 0.3));
});
