// Portada: idioma, aviso de preproducción y créditos. La app vive en /app/.
import { loadConfig } from './config.js';
import { applyI18n, getLang, LANGS, setLang, t } from './i18n.js';
import { registerPwa } from './pwa.js';

const cfg = loadConfig();
const $ = (id) => document.getElementById(id);

function readLang() {
  try {
    return JSON.parse(localStorage.getItem('gwr.lang')) || cfg.defaultLang;
  } catch {
    return cfg.defaultLang;
  }
}

function render() {
  applyI18n();
  const credits = t('footer', {
    meteo: '<a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>',
    map: cfg.tileAttribution,
  });
  const version = cfg.appVersion ? ` · <span class="version">${cfg.appVersion.replace(/[<>&"]/g, '')}</span>` : '';
  $('credits').innerHTML = credits + version;
}

setLang(readLang());
$('pre-banner').hidden = cfg.appEnv !== 'pre';
if (cfg.appEnv !== 'pro') document.title = `(${cfg.appEnv}) ${document.title}`;

const sel = $('lang');
const names = { es: 'Español', en: 'English' };
sel.innerHTML = LANGS.map((l) => `<option value="${l}">${names[l]}</option>`).join('');
sel.value = getLang();
sel.addEventListener('change', () => {
  setLang(sel.value);
  try {
    localStorage.setItem('gwr.lang', JSON.stringify(sel.value));
  } catch {
    /* sin almacenamiento */
  }
  render();
});

render();
registerPwa(cfg, 'sw.js');
