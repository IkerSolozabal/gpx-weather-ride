import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTrack } from '../web/js/lib/geo.js';
import { addRecent, RECENT_MAX, removeRecent, routeId, sanitizeRecent } from '../web/js/lib/recent.js';
import { decodeShare, encodeShare } from '../web/js/lib/share.js';
import { straightLine } from './helpers.js';

const entry = (id, savedAt = 1) => ({ id, name: id, km: 10, gain: 100, savedAt, hash: `r=${id}` });

test('addRecent pone la última arriba, sin duplicados y como mucho 5', () => {
  let list = [];
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) list = addRecent(list, entry(id));
  assert.equal(list.length, RECENT_MAX);
  assert.deepEqual(list.map((r) => r.id), ['f', 'e', 'd', 'c', 'b']);
  list = addRecent(list, entry('d', 2));
  assert.deepEqual(list.map((r) => r.id), ['d', 'f', 'e', 'c', 'b']);
  assert.equal(list[0].savedAt, 2);
  assert.deepEqual(removeRecent(list, 'f').map((r) => r.id), ['d', 'e', 'c', 'b']);
});

test('sanitizeRecent descarta basura', () => {
  assert.deepEqual(sanitizeRecent(null), []);
  assert.deepEqual(sanitizeRecent([entry('a'), { id: 1 }, null, { ...entry('b'), hash: 'x' }]).map((r) => r.id), ['a']);
});

test('routeId identifica la misma ruta aunque se cargue otra vez', () => {
  const t1 = buildTrack(straightLine({ km: 10 }));
  const t2 = buildTrack(straightLine({ km: 10 }));
  const t3 = buildTrack(straightLine({ km: 12 }));
  assert.equal(routeId('Ruta', t1), routeId('ruta ', t2));
  assert.notEqual(routeId('Ruta', t1), routeId('Ruta', t3));
});

test('una ruta guardada con poca tolerancia se recupera sin recortes y casi exacta', async () => {
  const track = buildTrack(straightLine({ km: 20, ele: 50 }));
  const { hash } = await encodeShare(track, { name: 'x', hideMeters: 0, tolerance: 2, maxLength: 60000 });
  const out = buildTrack((await decodeShare(hash)).points);
  assert.ok(Math.abs(out.total - track.total) < 5);
});
