import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NEWS } from '../web/js/i18n.js';
import { latestNews, unseenNews } from '../web/js/lib/news.js';

const releases = [{ id: '2026-09-01' }, { id: '2026-10-18' }, { id: '2026-10-01' }];
const ids = (list) => list.map((r) => r.id);

test('quien entra por primera vez no ve novedades', () => {
  assert.deepEqual(unseenNews(releases, null, false), []);
});

test('quien ya usaba la app y nunca las vio ve solo la más reciente', () => {
  assert.deepEqual(ids(unseenNews(releases, null, true)), ['2026-10-18']);
});

test('quien ya vio alguna ve las posteriores, de la más nueva a la más vieja', () => {
  assert.deepEqual(ids(unseenNews(releases, '2026-09-01', true)), ['2026-10-18', '2026-10-01']);
  assert.deepEqual(unseenNews(releases, '2026-10-18', true), []);
});

test('latestNews devuelve la fecha más reciente', () => {
  assert.equal(latestNews(releases), '2026-10-18');
  assert.equal(latestNews([]), null);
});

test('cada novedad tiene id con fecha y los mismos puntos en español y en inglés', () => {
  assert.ok(NEWS.length > 0);
  for (const r of NEWS) {
    assert.match(r.id, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.es.length > 0);
    assert.equal(r.es.length, r.en.length, r.id);
  }
});
