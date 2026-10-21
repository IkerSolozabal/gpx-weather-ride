/** Mapa con Leaflet: ruta coloreada por viento, flechas, puntos kilométricos, paradas y salida/llegada. */

import { t, weatherLabel } from '../i18n.js';
import { compass, windSide, WIND } from '../lib/wind.js';
import * as f from './format.js';

const L = () => window.L;

export function relLabel(rel, course, windDir) {
  if (!rel) return t('unknown');
  if (rel.category === WIND.CROSS) return windSide(course, windDir) === 'right' ? t('crossRight') : t('crossLeft');
  return t(rel.category);
}

/** Popup de una parada: llegada, salida y minutos. */
export function stopPopup(stop, n, { withDay }) {
  const leave = stop.arriveMs + stop.ms;
  return `<p class="pop-title">${t('stopTitle', { n, km: f.kmMark(stop.d) })}</p>
    <p>${t('stopTimes', { arrive: f.time(stop.arriveMs, { withDay }), leave: f.time(leave, { withDay }), min: f.span(stop.ms) })}</p>`;
}

/** HTML del detalle de un punto (popup del mapa). */
export function pointPopup(p, title, { withDay }) {
  const w = p.weather;
  const head = `<p class="pop-title">${f.escapeHtml(title)}<span>${f.time(p.time, { withDay })}</span></p>`;
  if (!w) return `${head}<p>${t('unknown')}</p>`;
  const sky = weatherLabel(w.code);
  const cat = p.rel ? p.rel.category : 'unknown';
  return `${head}
    <dl>
      <div class="pop-row"><dt>${t('temperature')}</dt><dd>${f.temp(w.temp)} <small>(${t('feels')} ${f.temp(w.feels)})</small></dd></div>
      <div class="pop-row"><dt>${t('wind')}</dt><dd>${f.num(w.windSpeed)} km/h ${t('from')} ${compass(w.windDir, document.documentElement.lang)}</dd></div>
      <div class="pop-row"><dt>${t('gustsLabel')}</dt><dd>${f.num(w.gusts)} km/h</dd></div>
      <div class="pop-row"><dt>${t('rainProb')}</dt><dd>${f.num(w.precipProb)} %</dd></div>
    </dl>
    ${sky.text ? `<p class="pop-sky">${sky.icon} ${f.escapeHtml(sky.text)}</p>` : ''}
    <p class="pop-rel c-${cat}">${relLabel(p.rel, p.course, w.windDir)}</p>`;
}

export function createMap(el, cfg) {
  const map = L().map(el, { zoomControl: true, preferCanvas: false }).setView([40.4, -3.7], 6);
  L()
    .tileLayer(cfg.tileUrl, { attribution: cfg.tileAttribution, maxZoom: cfg.tileMaxZoom })
    .addTo(map);

  const base = L().layerGroup().addTo(map);
  const route = L().layerGroup().addTo(map);
  const arrows = L().layerGroup().addTo(map);
  const kms = L().layerGroup().addTo(map);
  const flags = L().layerGroup().addTo(map);
  const stops = L().layerGroup().addTo(map);
  let layersControl = null;
  let cursor = null;
  const kmMarkers = [];
  let arrowMarkers = [];

  /** Oculta flechas y puntos kilométricos demasiado juntos para el zoom actual. */
  function thin() {
    const keep = (list, layer, minPx) => {
      let last = null;
      list.forEach((mk, i) => {
        if (!mk) return;
        const p = map.latLngToLayerPoint(mk.getLatLng());
        const isEnd = i === list.length - 1;
        const show = !last || p.distanceTo(last) >= minPx || (isEnd && p.distanceTo(last) >= minPx / 2);
        if (show) {
          last = p;
          if (!layer.hasLayer(mk)) layer.addLayer(mk);
        } else if (layer.hasLayer(mk) && !mk.isPopupOpen()) layer.removeLayer(mk);
      });
    };
    keep(arrowMarkers, arrows, 64);
    keep(kmMarkers, kms, 38);
  }
  map.on('zoomend', thin);

  function resetOverlays() {
    for (const g of [base, route, arrows, kms, flags, stops]) g.clearLayers();
    kmMarkers.length = 0;
    arrowMarkers = [];
    if (cursor) cursor.remove();
    cursor = null;
  }

  function addLayersControl() {
    if (layersControl) layersControl.remove();
    layersControl = L()
      .control.layers(null, { [t('layerArrows')]: arrows, [t('layerKm')]: kms }, { collapsed: true, position: 'topright' })
      .addTo(map);
  }

  /** Solo el trazado, antes de tener la meteo. */
  function showTrack(track) {
    resetOverlays();
    const latlngs = track.points.map((p) => [p.lat, p.lon]);
    L().polyline(latlngs, { color: '#ffffff', weight: 8, opacity: 0.9, interactive: false }).addTo(base);
    L().polyline(latlngs, { color: getCss('--ink'), weight: 4, opacity: 0.9, interactive: false }).addTo(route);
    addFlags(track.points[0], track.points[track.points.length - 1]);
    map.fitBounds(L().latLngBounds(latlngs), { padding: [24, 24] });
  }

  function addFlags(a, b, plan) {
    const icon = (cls, text) => L().divIcon({ className: `flag-marker ${cls}`, html: text, iconSize: null, iconAnchor: [0, 26] });
    const withDay = plan ? f.differentDay(plan.startMs, plan.endMs) : false;
    const s = L().marker([a.lat, a.lon], { icon: icon('flag-start', t('startPoint')), keyboard: false, zIndexOffset: 900 }).addTo(flags);
    const finishIcon = L().divIcon({ className: 'flag-marker flag-finish', html: t('finishPoint'), iconSize: null, iconAnchor: [0, -6] });
    const e = L().marker([b.lat, b.lon], { icon: finishIcon, keyboard: false, zIndexOffset: 900 }).addTo(flags);
    if (plan) {
      s.bindPopup(pointPopup(plan.markers[0], t('startPoint'), { withDay }));
      e.bindPopup(pointPopup(plan.markers[plan.markers.length - 1], t('finishPoint'), { withDay }));
    }
  }

  /** Ruta con la meteo: tramos coloreados, flechas y puntos kilométricos. */
  function showPlan(track, plan) {
    resetOverlays();
    const withDay = f.differentDay(plan.startMs, plan.endMs);
    const all = track.points.map((p) => [p.lat, p.lon]);
    L().polyline(all, { color: '#ffffff', weight: 9, opacity: 0.95, interactive: false }).addTo(base);
    for (const s of plan.segments) {
      L().polyline(s.coords, { color: getCss(`--${s.category}`), weight: 5, opacity: 1, lineCap: 'butt', interactive: false }).addTo(route);
    }

    for (const a of plan.arrows) {
      if (!a.weather) continue;
      const cat = a.rel ? a.rel.category : 'unknown';
      const icon = L().divIcon({
        className: `wind-marker c-${cat}`,
        html: `${f.arrowSvg(a.weather.windDir, 26, '')}<span class="speed">${f.num(a.weather.windSpeed)}</span>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      arrowMarkers.push(
        L()
          .marker([a.lat, a.lon], { icon, keyboard: false })
          .bindPopup(pointPopup(a, t('kmLabel', { km: f.kmMark(a.d) }), { withDay }))
          .addTo(arrows),
      );
    }

    plan.markers.forEach((m, i) => {
      if (i === 0 || i === plan.markers.length - 1) {
        kmMarkers.push(null);
        return;
      }
      const label = f.kmMark(m.d);
      const icon = L().divIcon({ className: 'km-marker', html: label, iconSize: [Math.max(22, label.length * 8 + 10), 20], iconAnchor: [11, 10] });
      const mk = L()
        .marker([m.lat, m.lon], { icon, zIndexOffset: 500, title: t('kmLabel', { km: label }) })
        .bindPopup(pointPopup(m, t('kmLabel', { km: label }), { withDay }))
        .addTo(kms);
      kmMarkers.push(mk);
    });

    addFlags(track.points[0], track.points[track.points.length - 1], plan);
    // Paradas: el mismo número que en la imagen para compartir.
    (plan.stops || []).forEach((st, i) => {
      const icon = L().divIcon({ className: 'stop-marker', html: String(i + 1), iconSize: [24, 24], iconAnchor: [12, 12] });
      L()
        .marker([st.lat, st.lon], { icon, zIndexOffset: 800, title: t('stopTitle', { n: i + 1, km: f.kmMark(st.d) }) })
        .bindPopup(stopPopup(st, i + 1, { withDay }))
        .addTo(stops);
    });
    addLayersControl();
    // Espera a que el panel de resultados ocupe su sitio antes de encuadrar.
    requestAnimationFrame(() => {
      map.invalidateSize();
      map.fitBounds(L().latLngBounds(all), { padding: [24, 24] });
      thin();
    });
  }

  function openMarker(i, plan) {
    const mk = kmMarkers[i];
    if (mk) {
      if (!kms.hasLayer(mk)) kms.addLayer(mk);
      if (!map.hasLayer(kms)) map.addLayer(kms);
      map.panTo(mk.getLatLng());
      mk.openPopup();
    } else if (plan) {
      const m = plan.markers[i];
      L().popup().setLatLng([m.lat, m.lon]).setContent(pointPopup(m, i === 0 ? t('startPoint') : t('finishPoint'), { withDay: f.differentDay(plan.startMs, plan.endMs) })).openOn(map);
    }
  }

  function moveCursor(p) {
    if (!p) {
      if (cursor) cursor.remove();
      cursor = null;
      return;
    }
    if (!cursor) {
      cursor = L().circleMarker([p.lat, p.lon], { radius: 7, color: getCss('--ink'), weight: 3, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(map);
    } else cursor.setLatLng([p.lat, p.lon]);
  }

  return { map, showTrack, showPlan, openMarker, moveCursor, invalidate: () => map.invalidateSize() };
}

function getCss(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#333';
}

