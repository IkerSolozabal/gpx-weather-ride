import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('../web/', import.meta.url));
const sw = readFileSync(join(web, 'sw.js'), 'utf8');
const precache = [...sw.slice(sw.indexOf('const PRECACHE'), sw.indexOf('];', sw.indexOf('const PRECACHE'))).matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [relative(web, p).split('\\').join('/')];
  });
}

test('el service worker precachea todos los archivos de la web', () => {
  const files = walk(web).filter((f) => !f.startsWith('vendor/') && f !== 'sw.js');
  const missing = files.filter((f) => !precache.includes(f));
  assert.deepEqual(missing, [], `Añade a PRECACHE en web/sw.js: ${missing.join(', ')}`);
});

test('todo lo precacheado existe (salvo vendor, que se genera al construir)', () => {
  const ghost = precache.filter((f) => f && !f.endsWith('/') && !f.startsWith('vendor/') && !existsSync(join(web, f)));
  assert.deepEqual(ghost, []);
});

test('el manifiesto es válido y sus iconos existen', () => {
  const m = JSON.parse(readFileSync(join(web, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.ok(m.start_url.startsWith('./app/'));
  assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
  for (const i of m.icons) assert.ok(existsSync(join(web, i.src)), i.src);
});

test('compartir un GPX desde otra app llega al service worker', () => {
  const m = JSON.parse(readFileSync(join(web, 'manifest.webmanifest'), 'utf8'));
  const st = m.share_target;
  assert.equal(st.method, 'POST');
  assert.equal(st.enctype, 'multipart/form-data');
  assert.ok(st.action.startsWith(m.scope), 'la acción tiene que estar dentro del scope');
  const param = new URL(st.action, 'https://x/').searchParams.keys().next().value;
  assert.ok(sw.includes(`searchParams.has('${param}')`), `sw.js no atiende ?${param}`);
  const field = st.params.files[0].name;
  assert.ok(sw.includes(`.get('${field}')`), `sw.js no lee el campo ${field}`);
  assert.ok(st.params.files[0].accept.includes('.gpx'));
});
