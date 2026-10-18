import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evenlyPick, fitView, project, tilesFor, tileUrl, toView } from '../web/js/lib/tiles.js';
import { straightLine } from './helpers.js';

test('project: el origen (0,0) cae en el centro del mundo', () => {
  const p = project(0, 0, 1);
  assert.equal(p.x, 256);
  assert.ok(Math.abs(p.y - 256) < 1e-9);
  assert.ok(project(43, -3, 10).y < project(42, -3, 10).y); // más al norte, más arriba
});

test('fitView encuadra la ruta dentro del rectángulo con margen', () => {
  const pts = straightLine({ km: 30, bearingDeg: 45 });
  const view = fitView(pts, 1000, 500, { padding: 40 });
  for (const p of [pts[0], pts.at(-1)]) {
    const v = toView(view, p.lat, p.lon);
    assert.ok(v.x >= 40 - 1 && v.x <= 960 + 1 && v.y >= 40 - 1 && v.y <= 460 + 1, JSON.stringify(v));
  }
  // Con un zoom más no cabría.
  const tighter = fitView(pts, 1000, 500, { padding: 40, minZoom: view.z + 1, maxZoom: view.z + 1 });
  const a = toView(tighter, pts[0].lat, pts[0].lon);
  const b = toView(tighter, pts.at(-1).lat, pts.at(-1).lon);
  assert.ok(Math.abs(b.x - a.x) > 920 || Math.abs(b.y - a.y) > 420);
});

test('tilesFor cubre la vista completa', () => {
  const view = fitView(straightLine({ km: 20 }), 1000, 520);
  const tiles = tilesFor(view);
  assert.ok(tiles.length >= 4 * 3);
  assert.ok(tiles.some((t) => t.dx <= 0 && t.dy <= 0));
  assert.ok(tiles.some((t) => t.dx + 256 >= 1000 && t.dy + 256 >= 520));
  assert.equal(tileUrl('https://{s}.tile.example/{z}/{x}/{y}{r}.png', { z: 3, x: 1, y: 2 }), 'https://a.tile.example/3/1/2.png');
});

test('evenlyPick incluye primero y último', () => {
  const list = Array.from({ length: 30 }, (_, i) => i);
  const out = evenlyPick(list, 8);
  assert.equal(out.length, 8);
  assert.equal(out[0], 0);
  assert.equal(out.at(-1), 29);
  assert.deepEqual(evenlyPick([1, 2], 8), [1, 2]);
});
