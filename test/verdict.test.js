import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTrack } from '../web/js/lib/geo.js';
import { computePlan } from '../web/js/lib/plan.js';
import { paceProfile } from '../web/js/lib/pacing.js';
import { verdict } from '../web/js/lib/verdict.js';
import { fakeFetch, fakeLocation, straightLine } from './helpers.js';

const DAY0 = Date.parse('2026-10-17T00:00:00Z');
const at = (h) => DAY0 + h * 3600_000;
const keys = (list) => list.map((v) => v.key);

/** Ida y vuelta de 2 × 15 km hacia el este, a 30 km/h (1 h). */
async function plan(location, { startH = 9, km = 15, bearingDeg = 90, pace } = {}) {
  const out = straightLine({ km, bearingDeg });
  const track = buildTrack([...out, ...[...out].reverse().slice(1)]);
  const opts = { startMs: at(startH), speedKmh: 30, sampleKm: 2, markerKm: 5, weather: { baseUrl: 'https://x/v1/forecast' } };
  if (pace) opts.pace = paceProfile(track, { sport: 'bike', speedKmh: 30, ...pace });
  return computePlan(track, opts, fakeFetch((s, h) => fakeLocation(s, h, location)));
}

test('viento del este: en contra a la ida y a favor a la vuelta', async () => {
  const v = verdict(await plan({ windDir: 90, windSpeed: 25, temp: 18, precipProb: 0 }));
  assert.deepEqual(keys(v), ['vMild', 'vWindHeadThenTail', 'vRainNone']);
});

test('frío, rachas y lluvia a partir de una hora', async () => {
  // Llueve a partir de las 9:30 UTC; sensación = temp − 2.
  const v = verdict(await plan({ windDir: 0, windSpeed: 30, gusts: 60, temp: 6, precipProb: (i) => (i % 24 >= 10 ? 80 : 0) }));
  assert.deepEqual(keys(v), ['vCold', 'vWindMixed', 'vGusts', 'vRainFrom']);
  const rain = v.find((x) => x.key === 'vRainFrom').vars;
  assert.ok(rain.timeMs >= at(9.5) && rain.timeMs <= at(10.5));
  assert.ok(rain.km > 0);
});

test('aviso de luces si se llega después de anochecer o se sale antes de amanecer', async () => {
  // Amanecer 7:00 y anochecer 18:00 UTC (helpers). Salida 17:30 → llegada 18:30.
  const late = verdict(await plan({ windSpeed: 5, temp: 15 }, { startH: 17.5 }));
  assert.equal(late[0].key, 'vDarkEnd');
  assert.ok(Math.abs(late[0].vars.afterMs - 30 * 60_000) < 60_000);
  const early = verdict(await plan({ windSpeed: 5, temp: 15 }, { startH: 6.5 }));
  assert.equal(early[0].key, 'vDarkStart');
  assert.ok(keys(early).includes('vWindCalm'));
});

test('las paradas retrasan la llegada y pueden hacer que se llegue de noche', async () => {
  const p = await plan({ windSpeed: 5, temp: 15 }, { startH: 16.5, pace: { stops: [{ km: 10, min: 60 }] } });
  assert.ok(Math.abs(p.endMs - at(18.5)) < 60_000);
  assert.equal(p.stopMs, 3600_000);
  assert.equal(verdict(p)[0].key, 'vDarkEnd');
});

test('salir de madrugada y terminar de día avisa del amanecer, no del anochecer', async () => {
  // Amanecer 7:00 UTC. Salida 6:00 del segundo día → llegada 7:00 + algo.
  const v = verdict(await plan({ windSpeed: 5, temp: 15 }, { startH: 24 + 6.25 }));
  assert.equal(v[0].key, 'vDarkStart');
  assert.ok(Math.abs(v[0].vars.beforeMs - 45 * 60_000) < 60_000);
  assert.ok(!keys(v).includes('vDarkEnd'));
});

test('toda la ruta de noche: un solo aviso', async () => {
  assert.equal(verdict(await plan({ windSpeed: 5, temp: 15 }, { startH: 24 + 4 }))[0].key, 'vDarkAll');
  assert.equal(verdict(await plan({ windSpeed: 5, temp: 15 }, { startH: 20 }))[0].key, 'vDarkAll');
});

test('las duraciones largas se leen en horas y minutos', async () => {
  const { span } = await import('../web/js/ui/format.js');
  assert.equal(span(45 * 60_000), '45 min');
  assert.equal(span(75 * 60_000), '1 h 15 min');
  assert.equal(span(120 * 60_000), '2 h');
});

test('el resumen dice cuánto retrasa o adelanta el viento, si se nota', () => {
  const base = { startMs: 0, endMs: 3600_000, distance: 10000, arrows: [], markers: [], segments: [], summary: { tempMin: null, windMax: 0, gustMax: 0, precipProbMax: 0, share: {} } };
  assert.deepEqual(verdict({ ...base, windDelayMs: 12 * 60_000 }).map((v) => v.key), ['vWindSlow']);
  assert.equal(verdict({ ...base, windDelayMs: -8 * 60_000 })[0].vars.delayMs, 8 * 60_000);
  assert.deepEqual(verdict({ ...base, windDelayMs: 3 * 60_000 }), []);
});
