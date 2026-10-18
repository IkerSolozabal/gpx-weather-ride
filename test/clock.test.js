import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatClock, nextDays, parseClock, stepClock } from '../web/js/lib/clock.js';

test('parseClock entiende las formas habituales de escribir una hora', () => {
  const cases = { '8': 480, '08': 480, '830': 510, '0830': 510, '8:30': 510, '8.30': 510, '8h30': 510, '8 30': 510, '20h': 1200, '2015': 1215, ' 07:05 ': 425, '0:00': 0, '23:59': 1439 };
  for (const [text, minutes] of Object.entries(cases)) assert.equal(parseClock(text), minutes, text);
  for (const bad of ['', 'abc', '24', '8:60', '25:00', '123456']) assert.equal(parseClock(bad), null, bad);
});

test('stepClock avanza y retrocede en pasos redondos y da la vuelta al día', () => {
  assert.equal(stepClock(480, 15), 495);
  assert.equal(stepClock(487, 15), 495); // 08:07 → 08:15
  assert.equal(stepClock(487, -15), 480); // 08:07 → 08:00
  assert.equal(stepClock(480, -15), 465);
  assert.equal(stepClock(1435, 15), 0); // 23:55 → 00:00
  assert.equal(stepClock(0, -15), 1425);
  assert.equal(formatClock(65), '01:05');
});

test('nextDays devuelve días consecutivos en hora local', () => {
  const days = nextDays(new Date(2026, 9, 30, 23, 30).getTime(), 4);
  assert.deepEqual(days, ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
});
