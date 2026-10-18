# Instrucciones para agentes

- Web estática sin paso de compilación: módulos ES nativos en `web/`. No añadir bundlers ni frameworks sin consultarlo.
- Dos páginas: portada en `web/index.html` (`landing.js`, `landing.css`) y aplicación en `web/app/index.html` (`app.js`, `app.css`). Lo común va en `base.css`. Usar siempre rutas relativas (`../css/…` desde la app). Una página nueva se añade también a `PAGES` en `scripts/build-static.mjs`.
- La lógica va en `web/js/lib/` como funciones puras, sin DOM ni Leaflet, con tests en `test/` (`npm test`, `node --test`, sin dependencias).
- La interfaz (`web/js/ui/`, `web/js/app.js`) puede usar el DOM y `window.L` (Leaflet global).
- Cada archivo nuevo de `web/` se añade a `PRECACHE` en `web/sw.js` (lo comprueba `test/pwa.test.js`).
- Todo texto visible pasa por `web/js/i18n.js`, en español y en inglés.
- Cualquier valor que pueda cambiar entre entornos es configuración: añadir la clave en `web/js/config.js` (`DEFAULTS`), la variable en `docker/entrypoint/40-app-config.sh` y documentarla en `.env.pro.example`, `.env.pre.example` y el README.
- Ramas: `develop` → preproducción (`pre.gpx.sogra.es`, Docker en la VM), `main` → producción (`gpx.sogra.es`, GitHub Pages). Los cambios entran por PR a `develop`.
- Una variable de configuración nueva va también en `ENV_MAP` de `scripts/build-static.mjs` y en `.github/workflows/pages.yml` (el test `build.test.js` comprueba que coincide con el script de Docker).
- Commits en español, con prefijo convencional (`feat:`, `fix:`, `chore:`, `docs:`, `ci:`).
