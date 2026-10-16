import { loadConfig } from './config.js';
import { applyI18n, getLang, LANGS, setLang, t, weatherLabel } from './i18n.js';
import { parseGpx, GpxError } from './lib/gpx.js';
import { bearingAround, buildTrack, elevationStats, pointAt } from './lib/geo.js';
import { formatDuration, parsePace, paceToKmh } from './lib/timing.js';
import { computePlan, nearestSample } from './lib/plan.js';
import { WeatherError } from './lib/weather.js';
import { relativeWind, WIND } from './lib/wind.js';
import { createMap, relLabel } from './ui/map.js';
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
};

const state = { track: null, routeName: null, plan: null, busy: false };

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

// --- Inicio ---
function init() {
  setLang(store.get('lang', cfg.defaultLang));
  document.title = cfg.appEnv === 'pre' ? `${cfg.appName} (pre)` : cfg.appName;
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

  els.form.addEventListener('change', onFormChange);
  els.form.addEventListener('input', onFormChange);
  els.form.addEventListener('submit', onSubmit);
  els.file.addEventListener('change', () => els.file.files[0] && loadFile(els.file.files[0]));
  $('change-route').addEventListener('click', () => els.file.click());
  setupDrop();

  refreshTexts();
}

function refreshTexts() {
  applyI18n();
  $('credits').innerHTML = t('footer', {
    meteo: '<a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>',
    map: cfg.tileAttribution,
  });
  els.submitLabel.textContent = state.plan ? t('update') : t('submit');
  if (state.track) showRouteInfo();
  updateEstimate();
  if (state.plan) renderPlan();
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
  state.plan = null;
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
}

function showRouteInfo() {
  $('route-name').textContent = state.routeName || t('unnamedRoute');
  $('route-distance').innerHTML = `${f.km(state.track.total, 1)}<small>km</small>`;
  const ele = elevationStats(state.track);
  $('route-ascent').innerHTML = ele ? `${f.num(ele.gain)}<small>m</small>` : '–';
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

/** Lee el formulario. Devuelve {startMs, speedKmh, sport} o {error, field}. */
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
  return { sport, startMs, speedKmh };
}

function updateEstimate() {
  const form = readForm();
  if (!state.track || form.error) {
    els.estimate.textContent = '';
    return;
  }
  const dur = (state.track.total / 1000 / form.speedKmh) * 3600_000;
  const end = form.startMs + dur;
  let text = t('estimate', { duration: formatDuration(dur), end: f.time(end, { withDay: f.differentDay(form.startMs, end) }) });
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
  const endMs = form.startMs + (state.track.total / 1000 / form.speedKmh) * 3600_000;
  if (endMs > Date.now() + cfg.forecastDays * DAY) return showMessage(t('err_range', { days: cfg.forecastDays }));

  setBusy(true);
  try {
    state.plan = await computePlan(state.track, {
      startMs: form.startMs,
      speedKmh: form.speedKmh,
      sampleKm: cfg.sampleKm,
      maxSamples: cfg.maxSamples,
      markerKm: form.sport === 'bike' ? cfg.bikeMarkerKm : cfg.runMarkerKm,
      segmentM: cfg.segmentM,
      wind: windOpts,
      weather: { baseUrl: cfg.weatherApiUrl, apiKey: cfg.weatherApiKey, models: cfg.weatherModels },
    });
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

function setBusy(on) {
  state.busy = on;
  els.submit.disabled = on;
  els.submit.classList.toggle('is-loading', on);
  els.submitLabel.textContent = on ? t('loading') : state.plan ? t('update') : t('submit');
}

function showMessage(text, warning = false) {
  els.message.textContent = text;
  els.message.classList.toggle('is-warning', warning);
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
}

function fig(label, value, sub) {
  return `<div><dt>${label}</dt><dd>${value}${sub ? `<span class="sub">${sub}</span>` : ''}</dd></div>`;
}

function hoverInfo(d) {
  if (d === null || !state.plan) {
    mapView.moveCursor(null);
    return null;
  }
  const { plan, track } = state;
  const p = pointAt(track, d);
  mapView.moveCursor(p);
  const time = plan.startMs + (d / 1000 / plan.speedKmh) * 3600_000;
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
