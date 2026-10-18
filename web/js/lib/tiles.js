/**
 * Matemática de teselas Web Mercator (las de OpenStreetMap) para dibujar un mapa
 * estático en un canvas sin Leaflet: proyección, zoom que encuadra la ruta y
 * teselas necesarias.
 */

const TILE = 256;

/** Píxel "del mundo" de una coordenada a un zoom dado. */
export function project(lat, lon, z) {
  const scale = TILE * 2 ** z;
  const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  };
}

export function bounds(points) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }
  return { minLat, maxLat, minLon, maxLon };
}

/**
 * Vista que encuadra los puntos en un rectángulo de width×height con un margen:
 * el zoom entero más alto en el que caben y el origen (esquina superior izquierda en píxeles del mundo).
 */
export function fitView(points, width, height, { padding = 40, maxZoom = 16, minZoom = 1 } = {}) {
  const b = bounds(points);
  let z = maxZoom;
  for (; z > minZoom; z--) {
    const a = project(b.maxLat, b.minLon, z);
    const c = project(b.minLat, b.maxLon, z);
    if (c.x - a.x <= width - 2 * padding && c.y - a.y <= height - 2 * padding) break;
  }
  const a = project(b.maxLat, b.minLon, z);
  const c = project(b.minLat, b.maxLon, z);
  const cx = (a.x + c.x) / 2;
  const cy = (a.y + c.y) / 2;
  return { z, left: cx - width / 2, top: cy - height / 2, width, height };
}

/** Posición en el rectángulo de la vista (0,0 arriba a la izquierda). */
export function toView(view, lat, lon) {
  const p = project(lat, lon, view.z);
  return { x: p.x - view.left, y: p.y - view.top };
}

/** Teselas que cubren la vista, con su posición de dibujo. */
export function tilesFor(view) {
  const n = 2 ** view.z;
  const out = [];
  const x0 = Math.floor(view.left / TILE);
  const x1 = Math.floor((view.left + view.width) / TILE);
  const y0 = Math.max(0, Math.floor(view.top / TILE));
  const y1 = Math.min(n - 1, Math.floor((view.top + view.height) / TILE));
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      out.push({ z: view.z, x: ((tx % n) + n) % n, y: ty, dx: tx * TILE - view.left, dy: ty * TILE - view.top });
    }
  }
  return out;
}

/** URL de una tesela a partir de la plantilla de Leaflet ({s}, {z}, {x}, {y}, {r}). */
export function tileUrl(template, t, subdomains = 'abc') {
  const s = subdomains[(t.x + t.y) % subdomains.length] || '';
  return template.replace('{s}', s).replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y).replace('{r}', '');
}

/** Hasta `max` elementos repartidos a lo largo de la lista, incluyendo siempre el primero y el último. */
export function evenlyPick(list, max) {
  if (list.length <= max) return list.slice();
  const out = [];
  for (let i = 0; i < max; i++) out.push(list[Math.round((i * (list.length - 1)) / (max - 1))]);
  return out;
}
