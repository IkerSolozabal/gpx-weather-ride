// Servidor estático mínimo para desarrollar sin Docker: `npm run dev`.
// Sirve web/ y, si existe node_modules (tras `npm install`), Leaflet y las fuentes en /vendor.
// Sin node_modules, la página carga Leaflet desde unpkg y usa fuentes del sistema.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const web = join(root, 'web');
const port = Number(process.env.PORT) || 5173;

const vendor = {
  '/vendor/leaflet/': join(root, 'node_modules/leaflet/dist/'),
  '/vendor/fonts/barlow-condensed-': join(root, 'node_modules/@fontsource/barlow-condensed/files/barlow-condensed-'),
  '/vendor/fonts/barlow-': join(root, 'node_modules/@fontsource/barlow/files/barlow-'),
};

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.gpx': 'application/gpx+xml',
  '.txt': 'text/plain; charset=utf-8',
};

async function exists(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function resolvePath(urlPath) {
  const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const local = join(web, safe.endsWith('/') ? `${safe}index.html` : safe);
  if (await exists(local)) return local;
  for (const [prefix, dir] of Object.entries(vendor)) {
    if (urlPath.startsWith(prefix)) return join(dir, urlPath.slice(prefix.length));
  }
  return local;
}

createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = await resolvePath(urlPath);
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) throw new Error('dir');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(port, () => console.log(`GPX Weather Ride en http://localhost:${port}`));
