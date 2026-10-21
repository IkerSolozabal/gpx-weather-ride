import { loadConfig } from './config.js';
import { applyI18n, getLang, LANGS, NEWS, setLang, t, weatherLabel } from './i18n.js';
import { parseGpx, GpxError } from './lib/gpx.js';
import { bearingAround, buildTrack, elevationStats, pointAt, reverseTrack } from './lib/geo.js';
import { formatDuration, formatPace, kmhToPace, parsePace, paceToKmh } from './lib/timing.js';
import { assemblePlan, fetchSeries, nearestSample } from './lib/plan.js';
import { daylightWindows, rankDays } from './lib/beststart.js';
import { decodeShare, encodeShare, ShareError } from './lib/share.js';
import { addRecent, removeRecent, routeId, sanitizeRecent } from './lib/recent.js';
import { buildGpx, fileName } from './lib/gpx-export.js';
import { latestNews, unseenNews } from './lib/news.js';
import { paceProfile } from './lib/pacing.js';
import { verdict } from './lib/verdict.js';
import { renderShareImage, toBlob } from './ui/export-image.js';
import { registerPwa } from './pwa.js';
import { createStartPicker } from './ui/start-picker.js';
import { WeatherError } from './lib/weather.js';
import { relativeWind, WIND } from './lib/wind.js';
import { createMap, relLabel } from './ui/map.js';
import { createNews } from './ui/news.js';
import { createProfile } from './ui/profile.js';
import * as f from './ui/format.js';

const cfg = loadConfig();
const $ = (id) => document.getElementById(id);
const DAY = 86_400_000;
const windOpts = { calm: cfg.calmKmh, headAngle: cfg.headAngle, tailAngle: cfg.tailAngle };

// --- Preferencias guardadas en el navegador (opcionales) ---
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`gwr.${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`gwr.${key}`, JSON.stringify(value));
    } catch {
      /* almacenamiento no disponible */
    }
  },
  /** ¿Ya había entrado antes? Hay algo guardado o un service worker de una visita anterior. */
  used() {
    try {
      if (Object.keys(localStorage).some((k) => k.startsWith('gwr.'))) return true;
    } catch {
      /* almacenamiento no disponible */
    }
    return Boolean(navigator.serviceWorker?.controller);
  },
};

// cache: series de Open-Meteo de la ruta actual para una franja de tiempo, reutilizables
// al cambiar la hora de salida o al comparar horas.
const state = { track: null, routeName: null, plan: null, busy: false, cache: null, best: null, reversed: false };

const els = {
  form: $('plan-form'),
  file: $('file'),
  drop: $('drop'),
  route: $('route'),
  start: $('start'),
  speed: $('speed'),
  pace: $('pace'),
  speedField: $('speed-field'),
  paceField: $('pace-field'),
  estimate: $('estimate'),
  submit: $('submit'),
  submitLabel: $('submit-label'),
  message: $('message'),
  results: $('results'),
  profile: $('profile'),
};

const mapView = createMap($('map'), cfg);
const profile = createProfile($('profile-canvas'), { onHover: hoverInfo, onPick: pickDistance });
const news = createNews($('news'), $('news-list'));

// --- Inicio ---
function init() {
  // Antes de guardar nada: así se distingue a quien vuelve de quien entra por primera vez.
  // Con NEWS_ENABLED=false no se enseñan ni se marcan como vistas: al activarlas, quien vuelva verá la última.
  const newsOn = cfg.newsEnabled === 'true';
  const unseen = newsOn ? unseenNews(NEWS, store.get('newsSeen', null), store.used()) : [];
  if (newsOn) store.set('newsSeen', latestNews(NEWS));
  $('news-open').hidden = !newsOn;
  $('news-sep').hidden = !newsOn;
  setLang(store.get('lang', cfg.defaultLang));
  if (cfg.appEnv !== 'pro') document.title = `(${cfg.appEnv}) ${document.title}`;
  $('app-name').textContent = cfg.appName;
  $('pre-banner').hidden = cfg.appEnv !== 'pre';

  const langSel = $('lang');
  const names = { es: 'Español', en: 'English' };
  langSel.innerHTML = LANGS.map((l) => `<option value="${l}">${names[l]}</option>`).join('');
  langSel.value = getLang();
  langSel.addEventListener('change', () => {
    setLang(langSel.value);
    store.set('lang', langSel.value);
    refreshTexts();
  });

  const saved = store.get('settings', {});
  const sport = saved.sport || cfg.defaultSport;
  els.form.sport.value = sport;
  els.speed.value = saved.speed || cfg.bikeSpeedKmh;
  els.pace.value = saved.pace || cfg.runPace;
  toggleSport(sport);

  const now = Date.now();
  const nextHour = Math.ceil(now / 3600_000) * 3600_000;
  els.start.value = f.toLocalInput(nextHour);
  els.start.min = f.toLocalInput(now - DAY);
  els.start.max = f.toLocalInput(now + cfg.forecastDays * DAY);
  // Días en botones y hora en dos casillas (móvil y ordenador). Intro en los minutos salta a la velocidad o ritmo.
  state.startPicker = createStartPicker(els.start, $('start-field'), {
    days: cfg.forecastDays,
    next: () => (els.speedField.hidden ? els.pace : els.speed),
  });

  els.form.addEventListener('change', onFormChange);
  els.form.addEventListener('input', onFormChange);
  els.form.addEventListener('submit', onSubmit);
  els.file.addEventListener('change', () => els.file.files[0] && loadFile(els.file.files[0]));
  $('best-run').addEventListener('click', onBestRun);
  const prio = store.get('bestPriority', 'balanced');
  $('best-priority').value = prio;
  $('best-priority').addEventListener('change', () => store.set('bestPriority', $('best-priority').value));
  $('share-run').addEventListener('click', onShare);
  // Al abrir «Más opciones» su contenido suele quedar fuera de la vista del panel: lo mostramos.
  $('advanced').addEventListener('toggle', (ev) => {
    if (!ev.target.open) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => ev.target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }));
  });
  window.addEventListener('hashchange', loadFromLink);
  $('recent-list').addEventListener('click', onRecentClick);
  $('export-image').addEventListener('click', onExportImage);
  $('export-gpx').addEventListener('click', onExportGpx);
  $('change-route').addEventListener('click', () => els.file.click());
  $('reverse-route').addEventListener('click', onReverse);
  $('stop-add').addEventListener('click', onAddStop);
  $('stops').addEventListener('click', onStopsClick);
  $('news-open').addEventListener('click', () => news.open(NEWS));
  setupDrop();

  refreshTexts();
  renderRecent();
  loadFromLink();
  loadSharedFile();
  // Ordenador con la app instalada: abrir un .gpx con doble clic (file_handlers del manifiesto).
  window.launchQueue?.setConsumer(async ({ files }) => {
    if (files && files[0]) loadFile(await files[0].getFile());
  });
  if (unseen.length) news.open(unseen);

  registerPwa(cfg, '../sw.js', { installButton: $('install'), onInstalled: () => showMessage(t('installDone'), 'info') });
  const connection = () => (navigator.onLine ? null : showMessage(t('offline'), true));
  window.addEventListener('offline', connection);
  window.addEventListener('online', () => showMessage(t('online'), 'info'));
  connection();
}

function refreshTexts() {
  applyI18n();
  state.startPicker?.refresh();
  news.refresh();
  $('credits').innerHTML = t('footer', {
    meteo: '<a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>',
    map: cfg.tileAttribution,
  });
  if (cfg.appVersion) $('credits').insertAdjacentHTML('beforeend', ` · <span class="version">${f.escapeHtml(cfg.appVersion)}</span>`);
  els.submitLabel.textContent = state.plan ? t('update') : t('submit');
  if (state.track) showRouteInfo();
  updateEstimate();
  if (state.plan) renderPlan();
  if (state.best) renderBest();
  renderRecent();
}

// --- Carga del GPX ---
function setupDrop() {
  const over = (on) => (ev) => {
    ev.preventDefault();
    els.drop.classList.toggle('is-over', on);
  };
  for (const target of [els.drop, document.body]) {
    target.addEventListener('dragover', over(true));
    target.addEventListener('dragleave', over(false));
    target.addEventListener('drop', (ev) => {
      over(false)(ev);
      const file = ev.dataTransfer?.files?.[0];
      if (file) loadFile(file);
    });
  }
}

async function loadFile(file) {
  hideMessage();
  if (file.size > cfg.maxFileMb * 1024 * 1024) return showMessage(t('err_too_big', { mb: cfg.maxFileMb }));
  let text;
  try {
    text = await file.text();
  } catch {
    return showMessage(t('err_read'));
  }
  try {
    const gpx = parseGpx(text);
    state.track = buildTrack(gpx.points);
    state.routeName = gpx.name || file.name.replace(/\.gpx$/i, '');
  } catch (err) {
    return showMessage(err instanceof GpxError ? t(`err_${err.code}`) : t('err_read'));
  } finally {
    els.file.value = '';
  }
  state.reversed = false;
  setStops();
  // Una ruta nueva sustituye a la del enlace compartido.
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  showLoadedRoute();
  rememberRoute();
}

/** GPX recibido con «Compartir» desde otra app: el service worker lo deja en la caché (ver sw.js). */
async function loadSharedFile() {
  const params = new URLSearchParams(location.search);
  if (!params.has('shared') || !('caches' in window)) return;
  params.delete('shared');
  const query = params.toString();
  history.replaceState(null, '', location.pathname + (query ? `?${query}` : '') + location.hash);
  try {
    const cache = await caches.open('gwr-share');
    const key = new URL('../shared.gpx', location.href).href; // junto a sw.js, que lo guarda
    const response = await cache.match(key);
    if (!response) return;
    await cache.delete(key);
    const name = decodeURIComponent(response.headers.get('X-File-Name') || 'ruta.gpx');
    loadFile(new File([await response.blob()], name));
  } catch {
    showMessage(t('err_read'));
  }
}

/** Prepara la interfaz para la ruta de state.track (de un GPX o de un enlace). */
function showLoadedRoute() {
  state.plan = null;
  state.cache = null;
  state.best = null;
  $('best-results').hidden = true;
  $('best-run').disabled = false;
  $('share-run').disabled = false;
  $('share-quick').hidden = false;
  $('share-status').hidden = true;
  $('share-link').hidden = true;
  setExportReady(false);
  els.results.hidden = true;
  els.profile.hidden = true;
  profile.clear();
  $('map-empty').hidden = true;
  els.drop.hidden = true;
  els.route.hidden = false;
  showRouteInfo();
  mapView.showTrack(state.track);
  els.submit.disabled = false;
  els.submitLabel.textContent = t('submit');
  updateEstimate();
  renderRecent();
}

function showRouteInfo() {
  $('route-name').textContent = `${state.routeName || t('unnamedRoute')}${state.reversed ? ` ${t('reversedSuffix')}` : ''}`;
  $('reverse-route').setAttribute('aria-pressed', String(state.reversed));
  $('reverse-label').textContent = state.reversed ? t('reversed') : t('reverse');
  $('route-distance').innerHTML = `${f.km(state.track.total, 1)}<small>km</small>`;
  const ele = elevationStats(state.track);
  $('route-ascent').innerHTML = ele ? `${f.num(ele.gain)}<small>m</small>` : '–';
}

/** Da la vuelta a la ruta y, si ya había meteo calculada, la recalcula en el nuevo sentido. */
function onReverse() {
  if (!state.track || state.busy) return;
  const hadPlan = Boolean(state.plan);
  const totalKm = state.track.total / 1000;
  state.track = reverseTrack(state.track);
  state.reversed = !state.reversed;
  // Las paradas siguen en el mismo sitio: su km se cuenta ahora desde el otro extremo.
  setStops(readStops().map((s) => ({ ...s, km: Number.isFinite(s.km) ? Math.round((totalKm - s.km) * 10) / 10 : '' })));
  showLoadedRoute();
  if (hadPlan) els.form.requestSubmit();
}

// --- Rutas recientes (localStorage) ---
const loadRecent = () => sanitizeRecent(store.get('recent', []));

/** Guarda la ruta actual (en su sentido original) al principio de las recientes. */
async function rememberRoute() {
  if (!state.track) return;
  const track = state.reversed ? reverseTrack(state.track) : state.track;
  state.routeId = routeId(state.routeName, track);
  try {
    const { hash } = await encodeShare(track, { name: state.routeName || '', hideMeters: 0, tolerance: 2, maxLength: 60_000 });
    const ele = elevationStats(track);
    const entry = { id: state.routeId, name: state.routeName || '', km: track.total / 1000, gain: ele ? ele.gain : null, savedAt: Date.now(), hash };
    store.set('recent', addRecent(loadRecent(), entry));
  } catch (err) {
    console.warn('No se ha podido guardar la ruta reciente', err);
  }
  renderRecent();
}

function timeAgo(ms) {
  const rtf = new Intl.RelativeTimeFormat(getLang() === 'en' ? 'en' : 'es', { numeric: 'auto' });
  const min = Math.round((ms - Date.now()) / 60_000);
  if (Math.abs(min) < 60) return rtf.format(min, 'minute');
  const h = Math.round(min / 60);
  if (Math.abs(h) < 24) return rtf.format(h, 'hour');
  return rtf.format(Math.round(h / 24), 'day');
}

function renderRecent() {
  const list = loadRecent().filter((r) => !state.track || r.id !== state.routeId);
  const box = $('recent');
  box.hidden = list.length === 0;
  // Sin ruta cargada la lista se ve abierta; con una ruta cargada queda plegada para no confundirse con ella.
  if (box.dataset.loaded !== String(Boolean(state.track))) {
    box.open = !state.track;
    box.dataset.loaded = String(Boolean(state.track));
  }
  $('recent-title').textContent = state.track ? t('recentOther') : t('recentTitle');
  $('recent-count').textContent = list.length;
  $('recent-list').innerHTML = list
    .map((r) => {
      const name = f.escapeHtml(r.name || t('unnamedRoute'));
      const gain = Number.isFinite(r.gain) ? ` · ${f.num(r.gain)} m+` : '';
      return `<li>
        <button type="button" class="recent-item" data-open="${f.escapeHtml(r.id)}">
          <span class="recent-name">${name}</span>
          <span class="recent-meta">${f.num(r.km, 1)} km${gain} · ${timeAgo(r.savedAt)}</span>
        </button>
        <button type="button" class="recent-del" data-del="${f.escapeHtml(r.id)}" aria-label="${f.escapeHtml(t('recentRemove', { name: r.name || t('unnamedRoute') }))}" title="${f.escapeHtml(t('recentRemove', { name: r.name || t('unnamedRoute') }))}">×</button>
      </li>`;
    })
    .join('');
}

async function onRecentClick(ev) {
  const del = ev.target.closest('[data-del]');
  if (del) {
    store.set('recent', removeRecent(loadRecent(), del.dataset.del));
    return renderRecent();
  }
  const open = ev.target.closest('[data-open]');
  if (!open) return;
  const entry = loadRecent().find((r) => r.id === open.dataset.open);
  if (!entry) return renderRecent();
  hideMessage();
  try {
    const route = await decodeShare(entry.hash);
    state.track = buildTrack(route.points);
    state.routeName = route.name || entry.name;
    state.reversed = false;
    setStops();
  } catch {
    store.set('recent', removeRecent(loadRecent(), entry.id));
    renderRecent();
    return showMessage(t('err_share_bad_link'));
  }
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  showLoadedRoute();
  rememberRoute();
}

// --- Exportar ---
function setExportReady(ready) {
  $('export-image').disabled = !ready;
  $('export-gpx').disabled = !ready;
  $('export-preview').hidden = true;
  $('export-status').textContent = ready ? t('exportReady') : t('exportNeedPlan');
}

function displayName() {
  return `${state.routeName || t('unnamedRoute')}${state.reversed ? ` ${t('reversedSuffix')}` : ''}`;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function onExportImage() {
  if (!state.plan) return;
  const btn = $('export-image');
  const status = $('export-status');
  btn.disabled = true;
  btn.classList.add('is-loading');
  try {
    const data = {
      track: state.track,
      plan: state.plan,
      routeName: displayName(),
      verdict: verdictText(state.plan),
      elevation: elevationStats(state.track),
      tileTemplate: cfg.tileUrl,
      siteLabel: location.host || 'GPX Weather Ride',
      attribution: `${t('footer', { meteo: 'Open-Meteo', map: '© OpenStreetMap' })}`,
    };
    let { canvas, tilesOk } = await renderShareImage(data);
    let blob;
    try {
      blob = await toBlob(canvas);
    } catch {
      blob = null; // el mapa de fondo no permite exportar (sin CORS): se repite sin teselas
    }
    if (!blob) {
      ({ canvas } = await renderShareImage({ ...data, tileTemplate: null }));
      blob = await toBlob(canvas);
      tilesOk = 0;
    }
    const name = fileName(displayName(), 'png');
    const file = new File([blob], name, { type: 'image/png' });
    const preview = $('export-preview');
    preview.src = URL.createObjectURL(blob);
    preview.alt = displayName();
    preview.hidden = false;
    let msg;
    if (window.matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: displayName() });
        msg = t('exportImageShared');
      } catch (err) {
        if (err && err.name === 'AbortError') msg = t('exportReady');
        else {
          download(blob, name);
          msg = t('exportImageDone');
        }
      }
    } else {
      download(blob, name);
      msg = t('exportImageDone');
    }
    status.textContent = tilesOk ? msg : `${msg} ${t('exportNoTiles')}`;
  } catch (err) {
    console.error(err);
    showMessage(t('err_generic', { detail: err.message }));
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
}

function onExportGpx() {
  if (!state.plan) return;
  const names = { rain: t('alertRain'), gusts: t('alertGusts'), head: t('alertHead') };
  const gpx = buildGpx({
    track: state.track,
    plan: state.plan,
    name: displayName(),
    label: (m, alerts) => {
      const w = m.weather;
      const name = `km ${f.kmMark(m.d)} ${f.time(m.time)}${alerts.length ? ' !' : ''}`;
      if (!w) return { name, desc: t('unknown') };
      const desc = t('wptDesc', {
        temp: f.temp(w.temp),
        wind: f.num(w.windSpeed),
        rel: relLabel(m.rel, m.course, w.windDir).toLowerCase(),
        gusts: f.num(w.gusts),
        rain: f.num(w.precipProb),
      });
      return { name, desc: alerts.length ? `! ${alerts.map((a) => names[a]).join(', ')}. ${desc}` : desc };
    },
  });
  download(new Blob([gpx], { type: 'application/gpx+xml' }), fileName(displayName(), 'gpx'));
  $('export-status').textContent = t('exportGpxDone');
}

// --- Formulario ---
function toggleSport(sport) {
  els.speedField.hidden = sport !== 'bike';
  els.paceField.hidden = sport !== 'run';
}

function onFormChange(ev) {
  if (ev.target.name === 'sport') {
    toggleSport(ev.target.value);
  }
  els.speed.removeAttribute('aria-invalid');
  els.pace.removeAttribute('aria-invalid');
  store.set('settings', { sport: els.form.sport.value, speed: els.speed.value, pace: els.pace.value });
  updateEstimate();
}

/** Lee el formulario. Devuelve {startMs, speedKmh, sport, stops} o {error, field}. */
function readForm() {
  const sport = els.form.sport.value;
  const startMs = els.start.value ? new Date(els.start.value).getTime() : NaN;
  if (!Number.isFinite(startMs)) return { error: 'err_start', field: els.start };
  let speedKmh;
  if (sport === 'bike') {
    speedKmh = parseFloat(String(els.speed.value).replace(',', '.'));
    if (!(speedKmh > 0)) return { error: 'err_speed', field: els.speed };
  } else {
    const pace = parsePace(els.pace.value);
    if (!pace) return { error: 'err_pace', field: els.pace };
    speedKmh = paceToKmh(pace);
  }
  return { sport, startMs, speedKmh, stops: readStops() };
}

// --- Paradas: cada una con su punto kilométrico y sus minutos (dependen de la ruta, no se guardan) ---
function stopRow({ km = '', min = '' } = {}) {
  const li = document.createElement('li');
  li.className = 'stop-row';
  li.innerHTML = `
    <span class="input-unit"><input type="number" class="stop-km" inputmode="decimal" min="0" step="0.1" data-i18n-aria="stopKm"><span>km</span></span>
    <span class="input-unit"><input type="number" class="stop-min" inputmode="numeric" min="0" max="1440" step="5" data-i18n-aria="stopMin"><span>min</span></span>
    <button type="button" class="stop-del" data-i18n-aria="stopDel">×</button>`;
  li.querySelector('.stop-km').value = km;
  li.querySelector('.stop-min').value = min;
  applyI18n(li);
  return li;
}

function setStops(stops = []) {
  $('stops').replaceChildren(...stops.map(stopRow));
}

/** Paradas del formulario con minutos: [{km, min}]. */
function readStops() {
  const num = (input) => parseFloat(String(input.value).replace(',', '.'));
  return [...$('stops').querySelectorAll('.stop-row')]
    .map((row) => ({ km: num(row.querySelector('.stop-km')), min: num(row.querySelector('.stop-min')) }))
    .filter((s) => s.min > 0);
}

/** Nueva parada a mitad de lo que queda tras la última, con 15 minutos. */
function onAddStop() {
  const totalKm = state.track ? state.track.total / 1000 : 0;
  const kms = [...$('stops').querySelectorAll('.stop-km')].map((i) => parseFloat(i.value)).filter(Number.isFinite);
  const last = kms.length ? Math.max(...kms) : 0;
  const row = stopRow({ km: totalKm ? Math.round((last + (totalKm - last) / 2) * 10) / 10 : '', min: 15 });
  $('stops').append(row);
  row.querySelector('.stop-km').focus();
  updateEstimate();
}

function onStopsClick(ev) {
  const del = ev.target.closest('.stop-del');
  if (!del) return;
  del.closest('.stop-row').remove();
  updateEstimate();
}

/** Tiempo de paso según la pendiente y las paradas (lib/pacing.js), reutilizado mientras no cambie nada. */

function paceFor(form) {
  const key = `${form.sport}|${form.speedKmh}|${JSON.stringify(form.stops)}`;
  const c = state.pace;
  if (c && c.track === state.track && c.key === key) return c.profile;
  const profile = paceProfile(state.track, { sport: form.sport, speedKmh: form.speedKmh, stops: form.stops });
  state.pace = { track: state.track, key, profile };
  return profile;
}

function updateEstimate() {
  const form = readForm();
  if (!state.track || form.error) {
    els.estimate.textContent = '';
    return;
  }
  const dur = (state.track.total / 1000 / form.speedKmh) * 3600_000;
  const stopMs = form.stops.reduce((a, s) => a + s.min, 0) * 60_000;
  const end = form.startMs + dur + stopMs;
  const vars = { duration: formatDuration(dur), stops: formatDuration(stopMs), end: f.time(end, { withDay: f.differentDay(form.startMs, end) }) };
  let text = t(stopMs ? 'estimateStops' : 'estimate', vars);
  if (form.sport === 'run') text += ` · ${f.num(form.speedKmh, 1)} km/h`;
  els.estimate.textContent = text;
}

async function onSubmit(ev) {
  ev.preventDefault();
  if (!state.track || state.busy) return;
  hideMessage();
  const form = readForm();
  if (form.error) {
    form.field.setAttribute('aria-invalid', 'true');
    form.field.focus();
    return showMessage(t(form.error));
  }
  const endMs = form.startMs + paceFor(form).totalMs;
  if (endMs > Date.now() + cfg.forecastDays * DAY) return showMessage(t('err_range', { days: cfg.forecastDays }));

  setBusy(true);
  try {
    state.plan = await planFor(form);
    renderPlan();
    if (state.plan.missingWeather) showMessage(t('warnMissing'), true);
  } catch (err) {
    console.error(err);
    if (err instanceof WeatherError) showMessage(t(`err_${err.code}`, { detail: err.detail || '', days: cfg.forecastDays }));
    else showMessage(t('err_generic', { detail: err.message }));
  } finally {
    setBusy(false);
  }
}

/** Opciones de cálculo comunes al plan y a la comparación de horas. */
function planOptions(sport) {
  return {
    sampleKm: cfg.sampleKm,
    maxSamples: cfg.maxSamples,
    markerKm: sport === 'bike' ? cfg.bikeMarkerKm : cfg.runMarkerKm,
    segmentM: cfg.segmentM,
    wind: windOpts,
    weather: { baseUrl: cfg.weatherApiUrl, apiKey: cfg.weatherApiKey, models: cfg.weatherModels },
  };
}

/** Series meteorológicas para [fromMs, toMs]; reutiliza las descargadas si cubren la franja. */
async function getSeries(fromMs, toMs) {
  const c = state.cache;
  if (c && c.track === state.track && c.fromMs <= fromMs && c.toMs >= toMs) return c;
  const data = await fetchSeries(state.track, { ...planOptions('bike'), fromMs, toMs });
  state.cache = { ...data, track: state.track };
  return state.cache;
}

async function planFor(form) {
  const { startMs, speedKmh, sport } = form;
  const pace = paceFor(form);
  const { samples, series } = await getSeries(startMs, startMs + pace.totalMs);
  return assemblePlan(state.track, samples, series, { ...planOptions(sport), startMs, speedKmh, pace });
}

function setBusy(on) {
  state.busy = on;
  els.submit.disabled = on;
  els.submit.classList.toggle('is-loading', on);
  els.submitLabel.textContent = on ? t('loading') : state.plan ? t('update') : t('submit');
}

/** kind: true o 'warning' (aviso amarillo), 'info' (verde) o nada (error). */
function showMessage(text, kind = false) {
  els.message.textContent = text;
  els.message.classList.toggle('is-warning', kind === true || kind === 'warning');
  els.message.classList.toggle('is-info', kind === 'info');
  els.message.hidden = false;
}
function hideMessage() {
  els.message.hidden = true;
}

// --- Resultados ---
function renderPlan() {
  const { plan, track } = state;
  const s = plan.summary;
  const withDay = f.differentDay(plan.startMs, plan.endMs);
  $('verdict').textContent = verdictText(plan);

  $('summary').innerHTML = [
    fig(t('arrival'), f.time(plan.endMs, { withDay }), formatDuration(plan.endMs - plan.startMs) + ' h'),
    fig(t('temperature'), s.tempMin === null ? '–' : `${f.temp(s.tempMin)} – ${f.temp(s.tempMax)}`),
    fig(t('wind'), `${f.num(s.windMax)}<small>km/h</small>`, `${t('gusts')} ${f.num(s.gustMax)} km/h`),
    fig(t('rain'), `${f.num(s.precipProbMax)}<small>%</small>`),
  ].join('');

  const order = [WIND.HEAD, WIND.CROSS, WIND.TAIL, WIND.CALM, 'unknown'];
  $('share-bar').innerHTML = order
    .filter((k) => s.share[k] > 0.001)
    .map((k) => `<span class="c-${k}" style="width:${(s.share[k] * 100).toFixed(2)}%" title="${t(k)}"></span>`)
    .join('');
  $('legend').innerHTML = order
    .filter((k) => k !== 'unknown' || s.share[k] > 0.001)
    .map((k) => `<li class="c-${k}"><span class="swatch"></span>${t(k)} <b>${Math.round(s.share[k] * 100)} %</b></li>`)
    .join('');

  const rows = $('km-rows');
  rows.innerHTML = plan.markers
    .map((m, i) => {
      const w = m.weather;
      const cat = m.rel ? m.rel.category : 'unknown';
      const sky = w ? weatherLabel(w.code) : { icon: '' };
      return `<tr data-i="${i}" class="c-${cat}" tabindex="0">
        <td class="km">${f.kmMark(m.d)}</td>
        <td class="time">${f.time(m.time, { withDay: withDay && (i === 0 || i === plan.markers.length - 1) })}</td>
        <td class="temp">${w ? f.temp(w.temp) : '–'}</td>
        <td>${
          w
            ? `<span class="wind">${f.arrowSvg(w.windDir)}<span><span class="wind-speed">${f.num(w.windSpeed)}</span> <span class="wind-rel">${relLabel(m.rel, m.course, w.windDir)}</span></span></span>`
            : '–'
        }</td>
        <td class="rain"><span class="icon" title="${sky.text || ''}">${sky.icon}</span>${w ? `${f.num(w.precipProb)} %` : ''}</td>
      </tr>`;
    })
    .join('');
  for (const tr of rows.querySelectorAll('tr')) {
    const open = () => {
      rows.querySelector('.is-active')?.classList.remove('is-active');
      tr.classList.add('is-active');
      mapView.openMarker(Number(tr.dataset.i), plan);
    };
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open()));
  }

  els.results.hidden = false;
  els.profile.hidden = false;
  mapView.invalidate();
  mapView.showPlan(track, plan);
  const hasEle = profile.show(track, plan);
  $('profile-note').hidden = hasEle;
  els.submitLabel.textContent = t('update');
  setExportReady(true);
  if (state.best) renderBest();
  if (state.scrollToMap) {
    state.scrollToMap = false;
    $('map').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/** El plan resumido en unas frases (lib/verdict.js). */
function verdictText(plan) {
  return verdict(plan, { comfortMin: cfg.comfortMinC, comfortMax: cfg.comfortMaxC })
    .map(({ key, vars }) =>
      t(key, {
        temp: f.temp(vars.temp),
        feels: f.temp(vars.feels),
        min: f.temp(vars.min),
        max: f.temp(vars.max),
        pct: Math.round(vars.pct ?? 0),
        kmh: f.num(vars.kmh),
        km: f.kmMark(vars.km ?? 0),
        time: vars.timeMs ? f.time(vars.timeMs) : '',
        sunrise: vars.sunriseMs ? f.time(vars.sunriseMs) : '',
        sunset: vars.sunsetMs ? f.time(vars.sunsetMs) : '',
        before: f.span(vars.beforeMs ?? 0),
        after: f.span(vars.afterMs ?? 0),
      }),
    )
    .join(' ');
}

function fig(label, value, sub) {
  return `<div><dt>${label}</dt><dd>${value}${sub ? `<span class="sub">${sub}</span>` : ''}</dd></div>`;
}

// --- Mejor momento para salir ---
async function onBestRun() {
  if (!state.track || state.busy) return;
  hideMessage();
  const form = readForm();
  if (form.error) {
    form.field.setAttribute('aria-invalid', 'true');
    return showMessage(t(form.error));
  }
  const pace = paceFor(form);
  const now = Date.now();
  const limit = now + cfg.forecastDays * DAY;

  const btn = $('best-run');
  btn.disabled = true;
  btn.classList.add('is-loading');
  try {
    // Una semana (o lo que llegue el pronóstico) en una sola consulta; las franjas con luz salen de ahí.
    const { samples, series } = await getSeries(now, Math.min(now + 8 * DAY, limit));
    const days = daylightWindows(series[0], { days: 7, durationMs: pace.totalMs, nowMs: now, stepMin: cfg.bestStartStepMin }).filter(
      (d) => d.toMs + pace.totalMs <= limit,
    );
    const opts = {
      track: state.track,
      samples,
      series,
      speedKmh: form.speedKmh,
      pace,
      stepMin: cfg.bestStartStepMin,
      priority: $('best-priority').value,
      wind: windOpts,
      comfortMin: cfg.comfortMinC,
      comfortMax: cfg.comfortMaxC,
    };
    const list = rankDays({ ...opts, days });
    state.best = { list, sport: form.sport, speedKmh: form.speedKmh };
    renderBest();
    if (!list.some((c) => c.best)) showMessage(t('err_best_none'));
  } catch (err) {
    console.error(err);
    if (err instanceof WeatherError) showMessage(t(`err_${err.code}`, { detail: err.detail || '', days: cfg.forecastDays }));
    else showMessage(t('err_generic', { detail: err.message }));
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
}

function renderBest() {
  const box = $('best-results');
  const { list } = state.best;
  const best = list.find((c) => c.best);
  const when = (ms) => f.time(ms, { withDay: true });
  const current = state.plan ? state.plan.startMs : null;
  let html = '';
  if (best) {
    html += `<p class="best-summary">${t('bestSummaryDay', {
      time: `<b>${when(best.startMs)}</b>`,
      head: Math.round(best.headShare * 100),
      rain: Math.round(best.rainMax),
      tmin: f.temp(best.tempMin),
      tmax: f.temp(best.tempMax),
    })}${best.darkShare > 0.02 ? ` ${t('bestDark')}` : ''}</p>`;
    html += `<button type="button" class="primary best-use" data-start="${best.startMs}">${t('bestUse', { time: when(best.startMs) })}</button>`;
  }
  html += `<p class="adv-hint">${t('bestPick')}</p><ul class="best-list">`;
  for (const c of list) {
    const ok = c.score !== null;
    const cls = ['best-row', c.best ? 'is-best' : '', current === c.startMs ? 'is-current' : ''].join(' ').trim();
    const width = ok ? Math.max(4, Math.round(c.quality * 100)) : 0;
    const meta = ok
      ? `${t('bestMeta', { temp: f.temp(c.tempMin), head: Math.round(c.headShare * 100), rain: Math.round(c.rainMax) })}${c.darkShare > 0.02 ? ' · 🌙' : ''}`
      : t('bestNoData');
    html += `<li><button type="button" class="${cls}" data-start="${c.startMs}" ${ok ? '' : 'disabled'}>
      <span class="best-time">${when(c.startMs)}</span>
      <span class="best-bar"><span style="width:${width}%"></span></span>
      <span class="best-meta">${meta}</span>
    </button></li>`;
  }
  html += '</ul>';
  box.innerHTML = html;
  box.hidden = false;
  for (const b of box.querySelectorAll('[data-start]')) {
    b.addEventListener('click', () => useStart(Number(b.dataset.start)));
  }
}

/** Pone la hora elegida en el formulario y calcula su ruta con la meteo ya descargada. */
async function useStart(startMs) {
  els.start.value = f.toLocalInput(startMs);
  state.startPicker?.refresh();
  updateEstimate();
  state.scrollToMap = window.matchMedia('(max-width: 860px)').matches;
  els.form.requestSubmit();
}

// --- Compartir por enlace ---
async function onShare() {
  if (!state.track) return;
  hideMessage();
  const form = readForm();
  const status = $('share-status');
  const linkInput = $('share-link');
  linkInput.hidden = true;
  let url;
  try {
    const { hash } = await encodeShare(state.track, {
      name: state.routeName || '',
      startMs: form.error ? undefined : form.startMs,
      sport: els.form.sport.value,
      speedKmh: form.error ? undefined : form.speedKmh,
      stops: form.error ? undefined : form.stops,
      hideMeters: $('share-hide').checked ? 500 : 0,
    });
    url = `${location.origin}${location.pathname}#${hash}`;
  } catch (err) {
    return showMessage(err instanceof ShareError ? t(`err_share_${err.code}`) : t('err_generic', { detail: err.message }));
  }
  const title = state.routeName || 'GPX Weather Ride';
  const touch = window.matchMedia('(pointer: coarse)').matches;
  try {
    if (touch && navigator.share) {
      await navigator.share({ title, url });
      status.textContent = t('shareShared');
    } else {
      await navigator.clipboard.writeText(url);
      status.textContent = t('shareCopied');
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return; // el usuario cerró el menú de compartir
    status.textContent = t('shareManual');
    linkInput.value = url;
    linkInput.hidden = false;
    linkInput.select();
  }
  status.hidden = false;
}

/** Si la URL trae una ruta compartida (#r=…), la carga y calcula su meteo. */
async function loadFromLink() {
  let shared;
  try {
    shared = await decodeShare(location.hash);
  } catch (err) {
    return showMessage(t(`err_share_${err.code || 'bad_link'}`));
  }
  if (!shared) return;

  state.track = buildTrack(shared.points);
  state.routeName = shared.name || t('unnamedRoute');
  state.reversed = false;
  if (shared.sport) {
    els.form.sport.value = shared.sport;
    toggleSport(shared.sport);
  }
  if (shared.speedKmh) {
    if (els.form.sport.value === 'run') els.pace.value = formatPace(kmhToPace(shared.speedKmh));
    else els.speed.value = Math.round(shared.speedKmh * 10) / 10;
  }
  setStops(shared.stops);
  const past = !shared.startMs || shared.startMs < Date.now();
  els.start.value = f.toLocalInput(past ? Math.ceil(Date.now() / 3600_000) * 3600_000 : shared.startMs);
  state.startPicker?.refresh();
  showLoadedRoute();
  rememberRoute();
  els.form.requestSubmit();
  // El mensaje se muestra después de que onSubmit limpie los anteriores.
  setTimeout(() => {
    if (els.message.hidden) showMessage(t(past && shared.startMs ? 'shareLoadedPast' : 'shareLoaded', { name: state.routeName }), 'info');
  }, 0);
}

function hoverInfo(d) {
  if (d === null || !state.plan) {
    mapView.moveCursor(null);
    return null;
  }
  const { plan, track } = state;
  const p = pointAt(track, d);
  mapView.moveCursor(p);
  const time = plan.timeAt(d);
  const a = plan.arrows[nearestSample(plan.arrows, d)];
  const w = a.weather;
  const ele = p.ele !== null ? ` · ${f.num(p.ele)} m` : '';
  const head = `<b>${f.km(d, 1)} km</b> · ${f.time(time)}${ele}`;
  if (!w) return head;
  const course = bearingAround(track, d);
  const rel = relativeWind(course, w.windDir, w.windSpeed, windOpts);
  return `${head}<br>${f.temp(w.temp)} · ${f.num(w.windSpeed)} km/h · ${relLabel(rel, course, w.windDir)}`;
}

function pickDistance(d) {
  if (!state.plan) return;
  const i = nearestSample(state.plan.markers, d);
  mapView.openMarker(i, state.plan);
}

init();
