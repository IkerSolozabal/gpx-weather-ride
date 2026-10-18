/**
 * Imagen para compartir (PNG 1080×1350, formato vertical de móvil) con cuatro zonas:
 * cabecera con el resumen, mapa con la ruta coloreada por el viento, perfil y horas de paso.
 * Se dibuja en un canvas sin Leaflet; las teselas del mapa se piden con CORS.
 */

import { pointAt } from '../lib/geo.js';
import { evenlyPick, fitView, tilesFor, tileUrl, toView } from '../lib/tiles.js';
import { t, weatherLabel } from '../i18n.js';
import * as f from './format.js';

const W = 1080;
const H = 1350;
const PAD = 56;

// Siempre en colores claros: la imagen se ve igual en cualquier móvil.
const C = {
  paper: '#eef1f0',
  surface: '#ffffff',
  ink: '#1d2b36',
  muted: '#5b6b77',
  line: '#d6dde1',
  head: '#c23b30',
  tail: '#22875a',
  cross: '#c98f0e',
  calm: '#8a9aa6',
  unknown: '#c7cfd4',
};
const FIG = '"Barlow Condensed", "Arial Narrow", sans-serif';
const TXT = 'Barlow, system-ui, sans-serif';

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'strict-origin-when-cross-origin';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

/** Flecha que apunta hacia donde sopla el viento. */
function windArrow(ctx, x, y, size, windFromDeg, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((((windFromDeg ?? 0) + 180) * Math.PI) / 180);
  ctx.fillStyle = color;
  const s = size / 24;
  ctx.beginPath();
  ctx.moveTo(0, -10 * s);
  ctx.lineTo(6.5 * s, 1 * s);
  ctx.lineTo(2 * s, 1 * s);
  ctx.lineTo(2 * s, 10 * s);
  ctx.lineTo(-2 * s, 10 * s);
  ctx.lineTo(-2 * s, 1 * s);
  ctx.lineTo(-6.5 * s, 1 * s);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// --- Zonas ---

function drawHeader(ctx, { plan, routeName, track, elevation }) {
  const withDay = f.differentDay(plan.startMs, plan.endMs);
  ctx.fillStyle = C.ink;
  ctx.font = `700 60px ${FIG}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(fitText(ctx, routeName || t('unnamedRoute'), W - 2 * PAD), PAD, 104);

  const date = new Intl.DateTimeFormat(document.documentElement.lang === 'en' ? 'en-GB' : 'es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(plan.startMs));
  ctx.font = `400 28px ${TXT}`;
  ctx.fillStyle = C.muted;
  const parts = [date, `${f.km(track.total, 1)} km`];
  if (elevation) parts.push(`${f.num(elevation.gain)} m+`);
  ctx.fillText(parts.join('  ·  '), PAD, 148);

  // Cifras: salida → llegada, temperatura, viento, lluvia
  const s = plan.summary;
  const figs = [
    [t('exportTimes'), `${f.time(plan.startMs)}–${f.time(plan.endMs, { withDay })}`],
    [t('temperature'), s.tempMin === null ? '–' : `${f.temp(s.tempMin)} – ${f.temp(s.tempMax)}`],
    [t('wind'), `${f.num(s.windMax)} km/h`],
    [t('rain'), `${f.num(s.precipProbMax)} %`],
  ];
  const colW = (W - 2 * PAD) / figs.length;
  figs.forEach(([label, value], i) => {
    const x = PAD + i * colW;
    ctx.fillStyle = C.muted;
    ctx.font = `400 24px ${TXT}`;
    ctx.fillText(label, x, 204);
    ctx.fillStyle = C.ink;
    ctx.font = `600 ${i === 0 ? 38 : 44}px ${FIG}`;
    ctx.fillText(fitText(ctx, value, colW - 16), x, 250);
  });

  // Barra del reparto del viento + leyenda
  const y = 276;
  const bw = W - 2 * PAD;
  let x = PAD;
  ctx.save();
  roundRect(ctx, PAD, y, bw, 14, 4);
  ctx.clip();
  for (const k of ['head', 'cross', 'tail', 'calm', 'unknown']) {
    const w = (s.share[k] || 0) * bw;
    ctx.fillStyle = C[k];
    ctx.fillRect(x, y, w + 0.5, 14);
    x += w;
  }
  ctx.restore();
  ctx.font = `400 22px ${TXT}`;
  x = PAD;
  for (const k of ['head', 'cross', 'tail']) {
    const label = `${t(k)} ${Math.round((s.share[k] || 0) * 100)} %`;
    ctx.fillStyle = C[k];
    ctx.fillRect(x, y + 32, 14, 14);
    ctx.fillStyle = C.ink;
    ctx.fillText(label, x + 22, y + 46);
    x += ctx.measureText(label).width + 52;
  }
}

async function drawMap(ctx, { track, plan, tileTemplate }, box) {
  ctx.save();
  roundRect(ctx, box.x, box.y, box.w, box.h, 14);
  ctx.clip();
  ctx.fillStyle = '#e4e8e6';
  ctx.fillRect(box.x, box.y, box.w, box.h);

  // Zoom entero que encuadra la ruta y, encima, una ampliación (hasta ×1,9) para que llene el recuadro.
  const pad = 48;
  const base = fitView(track.points, box.w, box.h, { padding: pad, maxZoom: 15 });
  const ends = track.points.map((p) => toView(base, p.lat, p.lon));
  const rw = Math.max(1, Math.max(...ends.map((e) => e.x)) - Math.min(...ends.map((e) => e.x)));
  const rh = Math.max(1, Math.max(...ends.map((e) => e.y)) - Math.min(...ends.map((e) => e.y)));
  const k = Math.max(1, Math.min(1.9, (box.w - 2 * pad) / rw, (box.h - 2 * pad) / rh));
  const view = { ...base, width: box.w / k, height: box.h / k, left: base.left + (box.w - box.w / k) / 2, top: base.top + (box.h - box.h / k) / 2 };
  const tiles = tileTemplate ? tilesFor(view) : [];
  const imgs = await Promise.all(tiles.map((tl) => loadImage(tileUrl(tileTemplate, tl))));
  let tilesOk = 0;
  imgs.forEach((img, i) => {
    if (!img) return;
    try {
      ctx.drawImage(img, box.x + tiles[i].dx * k, box.y + tiles[i].dy * k, 256 * k + 0.5, 256 * k + 0.5);
      tilesOk++;
    } catch {
      /* tesela no dibujable */
    }
  });
  // Velo claro para que la ruta destaque sobre el mapa.
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(box.x, box.y, box.w, box.h);

  const pt = (p) => {
    const v = toView(view, p[0] ?? p.lat, p[1] ?? p.lon);
    return [box.x + v.x * k, box.y + v.y * k];
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Borde blanco y tramos coloreados
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 13;
  ctx.beginPath();
  track.points.forEach((p, i) => (i ? ctx.lineTo(...pt(p)) : ctx.moveTo(...pt(p))));
  ctx.stroke();
  ctx.lineWidth = 7;
  for (const s of plan.segments) {
    ctx.strokeStyle = C[s.category] || C.unknown;
    ctx.beginPath();
    s.coords.forEach((c, i) => (i ? ctx.lineTo(...pt(c)) : ctx.moveTo(...pt(c))));
    ctx.stroke();
  }

  // Puntos kilométricos (los mismos que en la tabla de abajo)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const m of box.markers.slice(1, -1)) {
    const [x, y] = pt(m);
    const label = f.kmMark(m.d);
    ctx.font = `700 22px ${FIG}`;
    const w = Math.max(30, ctx.measureText(label).width + 16);
    roundRect(ctx, x - w / 2, y - 14, w, 28, 14);
    ctx.fillStyle = C.surface;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
    ctx.fillStyle = C.ink;
    ctx.fillText(label, x, y + 1);
  }
  // Salida y llegada
  const flag = (p, text, bg, fg, dy) => {
    const [x, y] = pt(p);
    ctx.font = `700 22px ${FIG}`;
    const w = ctx.measureText(text).width + 18;
    roundRect(ctx, x + 6, y + dy, w, 30, 5);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = 'left';
    ctx.fillText(text, x + 15, y + dy + 16);
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  };
  flag(track.points[0], t('startPoint'), C.tail, '#fff', -38);
  flag(track.points[track.points.length - 1], t('finishPoint'), C.ink, '#fff', 8);
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  return tilesOk;
}

function drawProfile(ctx, { track, plan }, box) {
  const total = track.total;
  const hasEle = track.points.some((p) => p.ele !== null);
  const cols = 400;
  const ds = Array.from({ length: cols + 1 }, (_, k) => (k / cols) * total);
  const eles = ds.map((d) => (hasEle ? pointAt(track, d).ele ?? 0 : 0));
  let lo = Math.min(...eles);
  let hi = Math.max(...eles);
  if (hi - lo < 50) {
    lo -= 25;
    hi += 25;
  }
  const axisH = 62;
  const ih = box.h - axisH - 34;
  const top = box.y + 34;
  const base = top + ih;
  const x = (d) => box.x + (d / total) * box.w;
  const y = hasEle ? (e) => base - ((e - lo) / (hi - lo)) * ih * 0.92 : () => base - ih * 0.45;

  ctx.fillStyle = C.ink;
  ctx.font = `600 26px ${FIG}`;
  ctx.fillText(t('profile'), box.x, box.y + 20);
  if (hasEle) {
    ctx.fillStyle = C.muted;
    ctx.font = `400 22px ${TXT}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${f.num(Math.min(...eles))} – ${f.num(Math.max(...eles))} m`, box.x + box.w, box.y + 20);
    ctx.textAlign = 'left';
  }

  let j = 0;
  const catAt = (d) => {
    while (j < plan.segments.length - 1 && plan.segments[j].to < d) j++;
    return plan.segments[j].category;
  };
  for (let k = 0; k < cols; k++) {
    ctx.fillStyle = C[catAt(ds[k])] || C.unknown;
    ctx.beginPath();
    ctx.moveTo(x(ds[k]), base);
    ctx.lineTo(x(ds[k]), y(eles[k]));
    ctx.lineTo(x(ds[k + 1]) + 0.6, y(eles[k + 1]));
    ctx.lineTo(x(ds[k + 1]) + 0.6, base);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ds.forEach((d, k) => (k ? ctx.lineTo(x(d), y(eles[k])) : ctx.moveTo(x(d), y(eles[k]))));
  ctx.stroke();

  // Eje con km y hora
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(box.x, base);
  ctx.lineTo(box.x + box.w, base);
  ctx.stroke();
  // Etiquetas separadas al menos 110 px; la llegada siempre se muestra.
  const lastIdx = plan.markers.length - 1;
  const shown = [];
  plan.markers.slice(0, lastIdx).forEach((m, i) => {
    if (!shown.length || x(m.d) - x(shown[shown.length - 1].m.d) >= 110) shown.push({ m, i });
  });
  while (shown.length > 1 && x(plan.markers[lastIdx].d) - x(shown[shown.length - 1].m.d) < 150) shown.pop();
  shown.push({ m: plan.markers[lastIdx], i: lastIdx });
  shown.forEach(({ m, i }) => {
    const px = x(m.d);
    const last = i === lastIdx;
    ctx.textAlign = i === 0 ? 'left' : last ? 'right' : 'center';
    ctx.fillStyle = C.muted;
    ctx.font = `500 22px ${FIG}`;
    ctx.fillText(`${f.kmMark(m.d)} km`, px, base + 28);
    ctx.fillStyle = C.ink;
    ctx.font = `600 24px ${FIG}`;
    ctx.fillText(f.time(m.time), px, base + 56);
  });
  ctx.textAlign = 'left';
}

function drawTimes(ctx, data, box, markers) {
  ctx.fillStyle = C.ink;
  ctx.font = `600 26px ${FIG}`;
  ctx.fillText(t('exportPassing'), box.x, box.y + 20);
  const perRow = markers.length <= 6 ? markers.length : Math.ceil(markers.length / 2);
  const rows = Math.ceil(markers.length / perRow);
  const cw = box.w / perRow;
  const top = box.y + 44;
  const rh = (box.h - 44) / rows;
  markers.forEach((m, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const x = box.x + col * cw;
    const y = top + row * rh;
    if (col > 0) {
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 10, y + 4);
      ctx.lineTo(x - 10, y + rh - 18);
      ctx.stroke();
    }
    const last = i === markers.length - 1;
    ctx.fillStyle = C.muted;
    ctx.font = `500 22px ${FIG}`;
    ctx.fillText(fitText(ctx, i === 0 ? t('startPoint') : last ? t('finishPoint') : `km ${f.kmMark(m.d)}`, cw - 16), x, y + 22);
    ctx.fillStyle = C.ink;
    ctx.font = `700 38px ${FIG}`;
    ctx.fillText(f.time(m.time), x, y + 60);
    const w = m.weather;
    if (!w) return;
    const cat = m.rel ? m.rel.category : 'unknown';
    ctx.font = `600 24px ${FIG}`;
    const temp = f.temp(w.temp);
    ctx.fillText(temp, x, y + 94);
    const tw = ctx.measureText(temp).width;
    windArrow(ctx, x + tw + 20, y + 86, 22, w.windDir, C[cat] || C.unknown);
    ctx.fillStyle = C[cat] || C.muted;
    ctx.fillText(f.num(w.windSpeed), x + tw + 34, y + 94);
  });
}

/**
 * Dibuja la imagen y devuelve { canvas, tilesOk }.
 * @param {{track, plan, routeName, tileTemplate, siteLabel, attribution}} data
 */
export async function renderShareImage(data) {
  try {
    await Promise.all([document.fonts.load(`700 60px ${FIG}`), document.fonts.load(`400 28px ${TXT}`)]);
  } catch {
    /* sin fuentes propias, se usan las del sistema */
  }
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);

  const markers = evenlyPick(data.plan.markers, 12);
  drawHeader(ctx, data);
  const tilesOk = await drawMap(ctx, data, { x: PAD, y: 346, w: W - 2 * PAD, h: 440, markers });
  drawProfile(ctx, data, { x: PAD, y: 806, w: W - 2 * PAD, h: 210 });
  drawTimes(ctx, data, { x: PAD, y: 1030, w: W - 2 * PAD, h: 262 }, markers);

  // Pie: web y créditos (la atribución de los mapas es obligatoria)
  ctx.fillStyle = C.ink;
  ctx.fillRect(0, H - 46, W, 46);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 24px ${FIG}`;
  ctx.fillText(data.siteLabel, PAD, H - 16);
  ctx.textAlign = 'right';
  ctx.font = `400 18px ${TXT}`;
  ctx.fillStyle = '#c9d2d8';
  ctx.fillText(data.attribution, W - PAD, H - 17);
  ctx.textAlign = 'left';
  return { canvas, tilesOk };
}

export const toBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
