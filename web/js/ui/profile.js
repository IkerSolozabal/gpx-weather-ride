/**
 * Perfil de la ruta en SVG: la silueta de altitud se rellena con el color del viento
 * de cada tramo, con km y hora de paso en el eje y la temperatura como línea discontinua.
 */

import { pointAt } from '../lib/geo.js';
import { t } from '../i18n.js';
import * as f from './format.js';

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

/**
 * @param {HTMLElement} container
 * @param {{onHover:(d:number|null)=>object|null, onPick:(d:number)=>void}} handlers
 */
export function createProfile(container, handlers) {
  let state = null;
  const tip = document.createElement('div');
  tip.className = 'profile-tip';
  tip.hidden = true;
  container.parentElement.appendChild(tip);

  function render() {
    if (!state) return;
    const { track, plan } = state;
    container.textContent = '';
    const W = container.clientWidth;
    const H = container.clientHeight;
    if (W < 50 || H < 50) return;

    const m = { l: 48, r: 40, t: 16, b: 38 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const total = track.total;
    const hasEle = track.points.some((p) => p.ele !== null);

    const cols = Math.max(2, Math.min(800, Math.floor(iw / 2)));
    const ds = Array.from({ length: cols + 1 }, (_, k) => (k / cols) * total);
    const eles = ds.map((d) => (hasEle ? pointAt(track, d).ele ?? 0 : 0));
    let lo = Math.min(...eles);
    let hi = Math.max(...eles);
    if (hi - lo < 50) {
      const mid = (hi + lo) / 2;
      lo = mid - 25;
      hi = mid + 25;
    }
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;

    const x = (d) => m.l + (d / total) * iw;
    const y = hasEle ? (e) => m.t + ih - ((e - lo) / (hi - lo)) * ih : () => m.t + ih * 0.45;
    const base = m.t + ih;

    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t('profile') });

    // Relleno por tramos de viento: columnas consecutivas con la misma categoría forman un polígono.
    const segAt = (() => {
      let j = 0;
      return (d) => {
        while (j < plan.segments.length - 1 && plan.segments[j].to < d) j++;
        return plan.segments[j];
      };
    })();
    const fill = el('g', {}, svg);
    let start = 0;
    let cat = segAt(ds[0]).category;
    const flush = (endIdx) => {
      const pts = [];
      for (let k = start; k <= endIdx; k++) pts.push(`${x(ds[k]).toFixed(1)},${y(eles[k]).toFixed(1)}`);
      pts.push(`${x(ds[endIdx]).toFixed(1)},${base}`, `${x(ds[start]).toFixed(1)},${base}`);
      el('polygon', { points: pts.join(' '), fill: `var(--${cat})`, opacity: 0.9 }, fill);
    };
    for (let k = 1; k <= cols; k++) {
      const c = segAt(ds[k]).category;
      if (c !== cat || k === cols) {
        flush(k);
        start = k;
        cat = c;
      }
    }

    el('polyline', { class: 'ridge', points: ds.map((d, k) => `${x(d).toFixed(1)},${y(eles[k]).toFixed(1)}`).join(' ') }, svg);

    // Eje: km y hora de paso, evitando que se pisen las etiquetas.
    const axis = el('g', { class: 'axis' }, svg);
    el('line', { x1: m.l, x2: m.l + iw, y1: base, y2: base }, axis);
    const withDay = f.differentDay(plan.startMs, plan.endMs);
    let lastX = -Infinity;
    // Con el día de la semana ("sáb, 23:00") las etiquetas de salida y llegada son más anchas.
    const minGap = withDay ? 86 : 58;
    plan.markers.forEach((mk, i) => {
      const px = x(mk.d);
      const isLast = i === plan.markers.length - 1;
      if (!isLast && px - lastX < minGap) return;
      if (isLast && px - lastX < minGap && i > 0) {
        // Si la llegada choca con el anterior, se queda la llegada.
        axis.lastChild?.remove();
        axis.lastChild?.remove();
      }
      const anchor = i === 0 ? 'start' : isLast ? 'end' : 'middle';
      el('text', { x: px, y: base + 15, 'text-anchor': anchor }, axis).textContent = `${f.kmMark(mk.d)} km`;
      el('text', { x: px, y: base + 30, 'text-anchor': anchor, class: 'hour' }, axis).textContent = f.time(mk.time, { withDay: withDay && (i === 0 || isLast) });
      lastX = px;
    });

    if (hasEle) {
      el('text', { x: m.l - 8, y: y(Math.max(...eles)) + 4, 'text-anchor': 'end' }, axis).textContent = `${f.num(Math.max(...eles))} m`;
      el('text', { x: m.l - 8, y: y(Math.min(...eles)) + 4, 'text-anchor': 'end' }, axis).textContent = `${f.num(Math.min(...eles))} m`;
    }

    // Temperatura a lo largo de la ruta (escala propia, etiquetas a la derecha).
    const temps = plan.arrows.filter((a) => a.weather && Number.isFinite(a.weather.temp));
    if (temps.length >= 2) {
      const tv = temps.map((a) => a.weather.temp);
      let tlo = Math.min(...tv);
      let thi = Math.max(...tv);
      if (thi - tlo < 4) {
        const mid = (thi + tlo) / 2;
        tlo = mid - 2;
        thi = mid + 2;
      }
      const ty = (v) => m.t + ih * 0.1 + (1 - (v - tlo) / (thi - tlo)) * ih * 0.5;
      el('polyline', { class: 'temp-line', points: temps.map((a) => `${x(a.d).toFixed(1)},${ty(a.weather.temp).toFixed(1)}`).join(' ') }, svg);
      const first = temps[0];
      const last = temps[temps.length - 1];
      el('text', { x: m.l + iw + 6, y: ty(last.weather.temp) + 4, 'text-anchor': 'start' }, axis).textContent = f.temp(last.weather.temp);
      el('text', { x: x(first.d) + 4, y: ty(first.weather.temp) - 6, 'text-anchor': 'start' }, axis).textContent = f.temp(first.weather.temp);
    }

    // Cursor
    const cursor = el('g', { class: 'cursor', visibility: 'hidden' }, svg);
    const cl = el('line', { y1: m.t, y2: base }, cursor);
    const cc = el('circle', { r: 4.5 }, cursor);

    const hit = el('rect', { x: m.l, y: 0, width: iw, height: H, fill: 'transparent' }, svg);
    hit.style.cursor = 'crosshair';
    const dAt = (ev) => {
      const r = svg.getBoundingClientRect();
      return Math.min(total, Math.max(0, ((ev.clientX - r.left - m.l) / iw) * total));
    };
    const move = (ev) => {
      const d = dAt(ev);
      const px = x(d);
      const e = hasEle ? pointAt(track, d).ele ?? 0 : 0;
      cl.setAttribute('x1', px);
      cl.setAttribute('x2', px);
      cc.setAttribute('cx', px);
      cc.setAttribute('cy', y(e));
      cursor.setAttribute('visibility', 'visible');
      const info = handlers.onHover(d);
      if (info) {
        tip.innerHTML = info;
        tip.hidden = false;
        const half = tip.offsetWidth / 2;
        tip.style.left = `${Math.min(W - half - 4, Math.max(half + 4, px))}px`;
      }
    };
    const leave = () => {
      cursor.setAttribute('visibility', 'hidden');
      tip.hidden = true;
      handlers.onHover(null);
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', leave);
    hit.addEventListener('click', (ev) => handlers.onPick(dAt(ev)));

    container.appendChild(svg);
  }

  const ro = new ResizeObserver(() => render());
  ro.observe(container);

  return {
    show(track, plan) {
      state = { track, plan };
      render();
      return track.points.some((p) => p.ele !== null);
    },
    clear() {
      state = null;
      container.textContent = '';
      tip.hidden = true;
    },
    render,
  };
}
