# syntax=docker/dockerfile:1

# --- Etapa 1: dependencias del navegador (Leaflet y fuentes) ---
FROM node:22-alpine AS vendor
WORKDIR /build
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund --no-package-lock
RUN set -eux; \
    mkdir -p out/leaflet out/fonts; \
    cp -r node_modules/leaflet/dist/leaflet.js node_modules/leaflet/dist/leaflet.css node_modules/leaflet/dist/images out/leaflet/; \
    for w in 400 500 600; do cp "node_modules/@fontsource/barlow/files/barlow-latin-$w-normal.woff2" out/fonts/; done; \
    for w in 500 600 700; do cp "node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-$w-normal.woff2" out/fonts/; done

# --- Etapa 2: tests (si fallan, la imagen no se construye) ---
FROM node:22-alpine AS test
WORKDIR /app
COPY package.json ./
COPY web ./web
COPY test ./test
RUN npm test && touch /app/.tests-ok

# --- Etapa 3: nginx sirviendo la web estática ---
FROM nginx:stable-alpine AS runtime

# Versión que se muestra en el pie (la rellena la CI con la rama y el commit).
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

# Valores por defecto; se cambian con variables de entorno al arrancar (ver .env.pro.example).
ENV APP_ENV=pro \
    WEATHER_API_URL=https://api.open-meteo.com/v1/forecast

COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=755 docker/entrypoint/ /docker-entrypoint.d/
COPY web /usr/share/nginx/html
COPY --from=vendor /build/out /usr/share/nginx/html/vendor
COPY --from=test /app/.tests-ok /tmp/.tests-ok

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/healthz || exit 1
