import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTrack } from '../web/js/lib/geo.js';
import { fetchSeries } from '../web/js/lib/plan.js';
import { candidateStarts, rankDays, rankStarts, scoreMetrics, PRIORITIES } from '../web/js/lib/beststart.js';
import { isDaylight, toSeries } from '../web/js/lib/weather.js';
import { fakeFetch, fakeLocation, straightLine } from './helpers.js';

const DAY0 = Date.parse('2026-10-17T00:00:00Z');
const H = 3600_000;
const at = (h) => DAY0 + h * H;

async function setup(location, { km = 30, bearingDeg = 0 } = {}) {
  const track = buildTrack(straightLine({ km, bearingDeg }));
  const data = await fetchSeries(
    track,
    { sampleKm: 5, fromMs: at(5), toMs: at(22), weather: { baseUrl: 'https://x/v1/forecast' } },
    fakeFetch((s, h) => fakeLocation(s, h, location)),
  );
  return { track, ...data };
}

test('candidateStarts incluye los extremos', () => {
  assert.equal(candidateStarts(at(8), at(10), 30).length, 5);
  assert.equal(candidateStarts(at(8), at(8), 30).length, 1);
});

test('isDaylight usa el amanecer y el anochecer del día', () => {
  const s = toSeries(fakeLocation(DAY0 / 1000, 48));
  assert.equal(isDaylight(s, at(12)), true);
  assert.equal(isDaylight(s, at(20)), false);
  assert.equal(isDaylight(s, at(6)), false);
  assert.equal(isDaylight(toSeries({ hourly: { time: [] } }), at(12)), null);
});

test('con prioridad viento elige la hora en que el viento sopla a favor', async () => {
  // Ruta hacia el norte. Viento del norte (en contra) hasta las 12 UTC y del sur (a favor) después.
  const d = await setup({ windDir: (i) => (i % 24 < 12 ? 0 : 180), windSpeed: 20 });
  const list = rankStarts({ ...d, speedKmh: 30, fromMs: at(8), toMs: at(14), priority: 'wind' });
  const best = list.find((c) => c.best);
  // A las 11:30 la interpolación ya da viento del sur, así que empata con las 12:00.
  assert.ok(best.startMs >= at(11.5), `mejor salida ${new Date(best.startMs).toISOString()}`);
  assert.ok(best.tailShare > 0.9);
  assert.equal(list.filter((c) => c.best).length, 1);
  assert.ok(list.every((c) => c.quality >= 0 && c.quality <= 1));
});

test('con prioridad lluvia evita la lluvia aunque el viento sea peor', async () => {
  // Por la mañana: viento a favor pero 90 % de lluvia. Por la tarde: viento en contra y seco.
  const d = await setup({
    windDir: (i) => (i % 24 < 12 ? 180 : 0),
    windSpeed: 15,
    precipProb: (i) => (i % 24 < 12 ? 90 : 0),
  });
  const rain = rankStarts({ ...d, speedKmh: 30, fromMs: at(8), toMs: at(14), priority: 'rain' }).find((c) => c.best);
  const wind = rankStarts({ ...d, speedKmh: 30, fromMs: at(8), toMs: at(14), priority: 'wind' }).find((c) => c.best);
  assert.ok(rain.startMs >= at(12));
  assert.ok(wind.startMs < at(12));
});

test('penaliza acabar de noche', async () => {
  const d = await setup({ windSpeed: 0 }, { km: 60 });
  // 60 km a 20 km/h = 3 h. Anochece a las 18 UTC: salir a las 17 deja casi toda la ruta de noche.
  const list = rankStarts({ ...d, speedKmh: 20, fromMs: at(10), toMs: at(17), priority: 'balanced' });
  const late = list[list.length - 1];
  assert.ok(late.darkShare > 0.6);
  assert.ok(list.find((c) => c.best).darkShare === 0);
});

test('sin pronóstico para la franja, la salida queda sin puntuar', async () => {
  const d = await setup({});
  const list = rankStarts({ ...d, speedKmh: 30, fromMs: at(30), toMs: at(31) });
  assert.ok(list.every((c) => c.score === null));
  assert.equal(list.some((c) => c.best), false);
});

test('scoreMetrics: el viento a favor bonifica y los pesos cambian el orden', () => {
  const base = { headKmh: 0, rainAvg: 0, tempPenalty: 0, darkShare: 0 };
  assert.ok(scoreMetrics({ ...base, headKmh: -10 }) < scoreMetrics(base));
  const windy = { ...base, headKmh: 15 };
  const wet = { ...base, rainAvg: 60 };
  assert.ok(scoreMetrics(windy, PRIORITIES.wind) > scoreMetrics(wet, PRIORITIES.wind));
  assert.ok(scoreMetrics(windy, PRIORITIES.rain) < scoreMetrics(wet, PRIORITIES.rain));
});

test('rankDays elige el mejor día con la misma franja horaria', async () => {
  // Ruta hacia el norte: el primer día viento del norte (en contra), el segundo del sur (a favor).
  const track = buildTrack(straightLine({ km: 30, bearingDeg: 0 }));
  const data = await fetchSeries(
    track,
    { sampleKm: 5, fromMs: at(5), toMs: at(24 + 22), weather: { baseUrl: 'https://x/v1/forecast' } },
    fakeFetch((s, h) => fakeLocation(s, h, { windDir: (i) => (i < 24 ? 0 : 180), windSpeed: 20 })),
  );
  const days = [0, 1, 9].map((k) => ({ fromMs: at(24 * k + 8), toMs: at(24 * k + 12) }));
  const list = rankDays({ track, ...data, speedKmh: 30, days, priority: 'wind' });
  assert.equal(list.length, 3);
  assert.equal(list.filter((c) => c.best).length, 1);
  assert.ok(list[1].best);
  assert.ok(list[1].startMs >= at(32) && list[1].startMs <= at(36));
  assert.equal(list[2].score, null); // día sin pronóstico
});

test('de madrugada cuenta el amanecer del mismo día, no el del anterior', async () => {
  const { sunTimes } = await import('../web/js/lib/weather.js');
  const s = toSeries(fakeLocation(DAY0 / 1000, 48));
  assert.equal(sunTimes(s, at(24 + 5)).sunrise, at(24 + 7));
  assert.equal(sunTimes(s, at(23)).sunset, at(18));
  assert.equal(isDaylight(s, at(24 + 7.5)), true);
});
