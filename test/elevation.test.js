import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTrack, elevationStats } from '../web/js/lib/geo.js';
import { elevationSamples, elevationUrlFor, fetchElevation, needsElevation, withElevation } from '../web/js/lib/elevation.js';
import { straightLine } from './helpers.js';

/** fetch falso: el terreno sube 10 m por cada 0,001° de latitud desde 43,26. */
function fakeElevation(calls = []) {
  return async (url) => {
    calls.push(url);
    const lats = new URL(url).searchParams.get('latitude').split(',').map(Number);
    return { ok: true, json: async () => ({ elevation: lats.map((lat) => Math.round((lat - 43.26) * 10000)) }) };
  };
}

test('needsElevation detecta rutas sin altitud', () => {
  assert.equal(needsElevation(buildTrack(straightLine({ km: 2 }))), false);
  assert.equal(needsElevation(buildTrack(straightLine({ km: 2, ele: null }))), true);
});

test('la URL de altitud sale de la del pronóstico', () => {
  assert.equal(elevationUrlFor('https://api.open-meteo.com/v1/forecast'), 'https://api.open-meteo.com/v1/elevation');
  assert.equal(elevationUrlFor('https://customer-api.open-meteo.com/v1/forecast?x=1'), 'https://customer-api.open-meteo.com/v1/elevation');
});

test('pide como mucho 500 puntos, en grupos de 100, y la ruta queda con altitud y desnivel', async () => {
  const track = buildTrack(straightLine({ km: 120, stepM: 50, ele: null }));
  const samples = elevationSamples(track);
  assert.ok(samples.length <= 500 && samples.length > 400, `${samples.length} puntos`);
  const calls = [];
  const eles = await fetchElevation(samples, { url: 'https://api.open-meteo.com/v1/elevation', apiKey: 'k' }, fakeElevation(calls));
  assert.equal(calls.length, Math.ceil(samples.length / 100));
  assert.match(calls[0], /apikey=k/);
  const out = withElevation(track, samples, eles);
  assert.equal(out.estimatedEle, true);
  assert.equal(needsElevation(out), false);
  assert.equal(out.points.length, track.points.length);
  // 120 km al norte ≈ 1,078° de latitud → unos 10.780 m de subida.
  assert.ok(Math.abs(elevationStats(out).gain - 10780) < 150, `desnivel ${elevationStats(out).gain}`);
});

test('en rutas cortas pide un punto cada 100 m, y si la API falla se nota', async () => {
  const track = buildTrack(straightLine({ km: 3, ele: null }));
  assert.equal(elevationSamples(track).length, 31);
  const broken = async () => ({ ok: false, json: async () => ({ error: true }) });
  await assert.rejects(fetchElevation(elevationSamples(track), { url: 'https://x/v1/elevation' }, broken));
});
