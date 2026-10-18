/**
 * Registro del service worker (app instalable y uso sin conexión) y botón «Instalar».
 * En desarrollo (appEnv = dev) no se registra, para no servir archivos antiguos de la caché.
 * @param {string} swUrl Ruta a sw.js relativa a la página (p. ej. '../sw.js' desde /app/).
 */
export function registerPwa(cfg, swUrl, { installButton, onInstalled } = {}) {
  if (!('serviceWorker' in navigator) || cfg.appEnv === 'dev') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(swUrl).catch((err) => console.warn('Service worker no registrado', err));
  });

  if (!installButton) return;
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault(); // mostramos nuestro propio botón
    deferred = ev;
    installButton.hidden = false;
  });
  installButton.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
    installButton.hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    installButton.hidden = true;
    if (onInstalled) onInstalled();
  });
}
