import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTrack } from '../web/js/lib/geo.js';
import { bikeSpeed, gradeProfile, paceProfile, runCost, windPace } from '../web/js/lib/pacing.js';
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
  const p = paceProfile(track, { sport: 'bike', speedKmh: 24, stops: [{ km: 20, min: 20 }, { km: 5, min: 10 }] });
  const expected = (track.total / 1000 / 24) * 3600_000;
  assert.ok(Math.abs(p.movingMs - expected) < 1);
  assert.ok(Math.abs(p.offset(track.total) - (expected + 30 * 60_000)) < 1);
  assert.equal(p.offset(0), 0);
});

test('cada parada retrasa el paso solo a partir de su kilómetro', () => {
  const track = climbRoute();
  const plain = paceProfile(track, { sport: 'bike', speedKmh: 24 });
  const p = paceProfile(track, { sport: 'bike', speedKmh: 24, stops: [{ km: 20, min: 20 }, { km: 5, min: 10 }] });
  const delay = (d) => Math.round((p.offset(d) - plain.offset(d)) / 60_000);
  assert.equal(delay(4000), 0);
  assert.equal(delay(6000), 10);
  assert.equal(delay(20000), 10); // al llegar a la parada aún no ha parado
  assert.equal(delay(21000), 30);
  assert.deepEqual(p.stops.map((s) => s.d), [5000, 20000]);
});

test('paradas sin km van a mitad de ruta y las de fuera de la ruta, a la meta', async () => {
  const { normalizeStops } = await import('../web/js/lib/pacing.js');
  assert.deepEqual(normalizeStops([{ min: 10 }, { km: 99, min: 5 }, { km: 3, min: 0 }], 30000), [
    { d: 15000, ms: 600_000 },
    { d: 30000, ms: 300_000 },
  ]);
  const track = climbRoute();
  const p = paceProfile(track, { sport: 'run', speedKmh: 10, stops: [{ km: 99, min: 5 }] });
  assert.ok(Math.abs(p.offset(track.total) - p.totalMs) < 1);
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
  assert.ok(flat.wkg < hilly.wkg); // misma media en llano: menos nivel
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

test('viento: de cara se tarda más, a favor menos, y sin viento sale lo mismo', () => {
  const track = climbRoute();
  const base = paceProfile(track, { sport: 'bike', speedKmh: 24, stops: [{ km: 15, min: 10 }] });
  const calm = windPace(track, base, () => 0, 0);
  assert.ok(Math.abs(calm.totalMs - base.totalMs) < 1);
  assert.ok(Math.abs(calm.offset(12000) - base.offset(12000)) < 1);
  const head = windPace(track, base, () => 20, 0);
  const tail = windPace(track, base, () => -20, 0);
  assert.ok(head.windDelayMs > 5 * 60_000, `de cara retrasa ${head.windDelayMs / 60_000} min`);
  assert.ok(tail.windDelayMs < -3 * 60_000, `a favor adelanta ${-tail.windDelayMs / 60_000} min`);
  assert.equal(head.stopMs, base.stopMs);
});

test('viento: pesa más en llano que en el puerto, y corriendo no cambia', () => {
  const track = climbRoute();
  const base = paceProfile(track, { sport: 'bike', speedKmh: 24 });
  const head = windPace(track, base, () => 20, 0);
  const extra = (a, b) => head.offset(b) - head.offset(a) - (base.offset(b) - base.offset(a));
  const flat = extra(0, 10000) / (base.offset(10000) - base.offset(0));
  const climb = extra(10000, 20000) / (base.offset(20000) - base.offset(10000));
  assert.ok(flat > climb * 2, `llano +${Math.round(flat * 100)} %, puerto +${Math.round(climb * 100)} %`);
  const run = paceProfile(track, { sport: 'run', speedKmh: 10 });
  assert.equal(windPace(track, run, () => 20, 0).windDelayMs, 0);
});

test('viento: también en una ruta llana, y se usa el que hay al pasar por cada tramo', () => {
  const flatTrack = buildTrack(straightLine({ km: 20, stepM: 100, ele: 100 }));
  const flat = paceProfile(flatTrack, { sport: 'bike', speedKmh: 25 });
  assert.ok(Math.abs(windPace(flatTrack, flat, () => 0, 0).totalMs - flat.totalMs) < 1);
  assert.ok(windPace(flatTrack, flat, () => 20, 0).windDelayMs > 5 * 60_000);
  // Viento de cara solo a partir de los 30 min desde la salida.
  const track = climbRoute();
  const base = paceProfile(track, { sport: 'bike', speedKmh: 24 });
  const later = windPace(track, base, (d, t) => (t >= 30 * 60_000 ? 25 : 0), 0);
  assert.ok(Math.abs(later.offset(5000) - base.offset(5000)) < 1);
  assert.ok(later.offset(track.total) > base.offset(track.total) + 60_000);
});
