#!/bin/sh
# Genera /config.js y /robots.txt a partir de las variables de entorno,
# para cambiar la configuración sin reconstruir la imagen.
set -eu

HTML=${APP_HTML_DIR:-/usr/share/nginx/html}

# Escapa una cadena para meterla entre comillas dobles en JavaScript.
esc() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's#</#<\\/#g' | tr '\n' ' '
}

entries=""
# add <clave en APP_CONFIG> <variable de entorno>: solo si la variable tiene valor.
add() {
  eval "val=\${$2-}"
  if [ -n "$val" ]; then
    entries="${entries}  \"$1\": \"$(esc "$val")\",
"
  fi
}

add appEnv           APP_ENV
add appName          APP_NAME
add appVersion       APP_VERSION
add defaultLang      APP_DEFAULT_LANG
add newsEnabled      NEWS_ENABLED

add weatherApiUrl    WEATHER_API_URL
add weatherApiKey    WEATHER_API_KEY
add weatherModels    WEATHER_MODELS
add forecastDays     WEATHER_FORECAST_DAYS

add tileUrl          MAP_TILE_URL
add tileAttribution  MAP_TILE_ATTRIBUTION
add tileMaxZoom      MAP_MAX_ZOOM

add sampleKm         ROUTE_SAMPLE_KM
add maxSamples       ROUTE_MAX_SAMPLES
add segmentM         ROUTE_SEGMENT_M
add maxFileMb        GPX_MAX_FILE_MB

add defaultSport     DEFAULT_SPORT
add bikeSpeedKmh     BIKE_SPEED_KMH
add runPace          RUN_PACE
add bikeMarkerKm     BIKE_MARKER_KM
add runMarkerKm      RUN_MARKER_KM

add bestStartStepMin BEST_START_STEP_MIN
add comfortMinC      TEMP_COMFORT_MIN
add comfortMaxC      TEMP_COMFORT_MAX

add calmKmh          WIND_CALM_KMH
add headAngle        WIND_HEAD_ANGLE
add tailAngle        WIND_TAIL_ANGLE

{
  echo "// Generado al arrancar el contenedor ($(date -u +%Y-%m-%dT%H:%M:%SZ)). No editar."
  echo "window.APP_CONFIG = {"
  printf '%s' "$entries"
  echo "};"
} > "$HTML/config.js"

if [ "${ROBOTS_INDEX:-false}" = "true" ]; then
  printf 'User-agent: *\nAllow: /\n' > "$HTML/robots.txt"
else
  printf 'User-agent: *\nDisallow: /\n' > "$HTML/robots.txt"
fi

echo "gpx-weather-ride: entorno=${APP_ENV:-pro} versión=${APP_VERSION:-dev} indexación=${ROBOTS_INDEX:-false}"
