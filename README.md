# GPX Weather Ride

Carga una ruta GPX de ciclismo o carrera, elige la hora de salida y tu velocidad media (o ritmo), y mira en un mapa:

- **El viento en cada tramo**: en contra, a favor, lateral o calma, según el rumbo del tramo y la dirección del viento a la hora en que pasarás por él.
- **La hora de paso** por cada punto kilométrico.
- **La temperatura**, la sensación térmica, las rachas y la probabilidad de lluvia en cada punto.
- **Un perfil de altitud** relleno con el color del viento, con km y hora de paso en el eje.

Es una web estática: el GPX se procesa en el navegador y nunca se sube a ningún servidor. La meteo viene de [Open-Meteo](https://open-meteo.com/) (gratis, sin clave) y el mapa de [OpenStreetMap](https://www.openstreetmap.org/) con [Leaflet](https://leafletjs.com/).

| Entorno | Dominio | Rama | Dónde se ejecuta |
| --- | --- | --- | --- |
| Producción | `gpx.sogra.es` | `main` | GitHub Pages (workflow `pages.yml`) |
| Preproducción | `pre.gpx.sogra.es` | `develop` | Docker en la VM, imagen `ghcr.io/ikersolozabal/gpx-weather-ride:pre` |

## Páginas

| Ruta | Qué es |
| --- | --- |
| `/` | Portada: explica la herramienta, cómo funciona y preguntas frecuentes. El botón **App** lleva a la aplicación. |
| `/app/` | La aplicación: subir el GPX, elegir salida y ritmo, mapa, perfil y tabla. |

Las dos comparten idioma (se guarda en el navegador), estilos base y configuración (`config.js`). Las rutas internas son relativas, así que funcionan igual en nginx, en GitHub Pages y en una subcarpeta.

## Cómo funciona

1. Se leen los puntos del GPX (`<trkpt>` o, si no hay, `<rtept>`) y se calcula la distancia acumulada.
2. Hora de paso = hora de salida + distancia ÷ velocidad media (constante en esta primera versión).
3. Se toma un punto cada `ROUTE_SAMPLE_KM` km (2 por defecto) y se pide a Open-Meteo el pronóstico horario de todos ellos en una o pocas peticiones. Si el GPX trae altitud, se envía para corregir la temperatura.
4. Para cada tramo de `ROUTE_SEGMENT_M` metros se interpola la meteo a la hora de paso y se compara la dirección del viento con el rumbo del tramo:
   - **En contra**: el viento llega a menos de 45° del frente.
   - **A favor**: llega a más de 135° (por detrás).
   - **Lateral**: el resto, indicando si entra por la izquierda o la derecha.
   - **Calma**: menos de 5 km/h.

Los umbrales se cambian con variables de entorno.

## Más opciones

La app tiene un desplegable **Más opciones**, cerrado por defecto, con funciones para quien las quiera sin complicar el uso normal.

### Mejor hora de salida

Prueba salidas cada `BEST_START_STEP_MIN` minutos (30 por defecto) dentro de una franja del día elegido y puntúa cada una (menos es mejor):

| Factor | Cómo se mide | Vale 1 cuando… |
| --- | --- | --- |
| Viento | Componente media del viento en contra a lo largo de la ruta (a favor resta) | 15 km/h de media en contra |
| Lluvia | Probabilidad media de lluvia | 40 % |
| Temperatura | Grados de sensación térmica fuera de `TEMP_COMFORT_MIN`–`TEMP_COMFORT_MAX` | 8 °C fuera del rango |
| Noche | Parte de la ruta antes del amanecer o después del anochecer | La mitad de la ruta |

El selector «Qué evitar sobre todo» multiplica por 3 el peso del factor elegido (viento, lluvia o temperatura); «Un poco de todo» los pesa igual. Toda la franja se pide a Open-Meteo en una sola consulta y las salidas se calculan en el navegador; al elegir una hora, su ruta se pinta sin volver a consultar la API. La lógica está en `web/js/lib/beststart.js`.

## Estructura

```
web/                    La web que se sirve (HTML, CSS y módulos JS, sin compilación)
├── index.html          Portada (/): qué es, cómo funciona, preguntas frecuentes y botón «App»
├── app/index.html      La aplicación (/app/)
├── 404.html            Página de error
├── config.js           Configuración para desarrollo (en Docker se genera al arrancar)
├── css/
│   ├── base.css        Tipografías, colores, modo oscuro y colores del viento (común)
│   ├── landing.css     Portada y 404
│   └── app.css         Aplicación
└── js/
    ├── landing.js      Portada: idioma, aviso de pre y créditos
    ├── app.js          Aplicación: arranque y formulario
    ├── config.js       Valores por defecto de la configuración
    ├── i18n.js         Textos en español e inglés (portada y app)
    ├── lib/            Lógica pura y testeada: GPX, geometría, tiempos, meteo, viento, plan
    └── ui/             Mapa (Leaflet), perfil (SVG) y formato
test/                   Tests con node --test (sin dependencias)
scripts/                Servidor de desarrollo y generador de la web estática (GitHub Pages)
docker/                 Plantilla de nginx y scripts que generan config.js al arrancar
deploy/                 Ejemplo de Caddyfile para el proxy inverso
compose.yml             Producción y preproducción
compose.build.yml       Variante para compilar la imagen en la propia VM
```

## Desarrollo local

Requisitos: Node.js 20 o superior.

```bash
npm install     # Leaflet y las fuentes (opcional: sin esto se usan unpkg y las fuentes del sistema)
npm run dev     # portada en http://localhost:5173 y app en http://localhost:5173/app/
npm test
npm run build   # genera dist/, la misma web que se publica en GitHub Pages
```

No hay paso de compilación: editas `web/` y recargas. Para probar otra configuración en local, edita `web/config.js` (por ejemplo `appEnv: 'pre'` muestra el aviso de preproducción).

## Flujo de ramas

1. Trabaja en una rama a partir de `develop` (`feat/...`, `fix/...`) y abre un PR hacia `develop`.
2. Al fusionar en `develop`, GitHub Actions pasa los tests y publica la imagen `:pre`.
3. En la VM: `docker compose pull web-pre && docker compose up -d web-pre` → revísalo en `pre.gpx.sogra.es`.
4. Cuando esté bien, PR de `develop` a `main`. Al fusionar, el workflow **Producción (GitHub Pages)** pasa los tests y publica la web en `gpx.sogra.es`. No hay que tocar nada en la VM.

Cada imagen de Docker se publica también con la etiqueta `sha-<commit>`, para volver a una versión anterior fijando `PRE_IMAGE` en `.env`. La versión desplegada (rama@commit) aparece al pie de la página.

## Producción en GitHub Pages

La web es estática, así que producción se sirve gratis desde GitHub Pages. `scripts/build-static.mjs` genera `dist/` con Leaflet, las fuentes y un `config.js` hecho con las mismas variables que usa Docker.

### Configurar una vez

1. **Activar Pages:** Settings → Pages → *Build and deployment* → Source: **GitHub Actions**.
2. **Dominio propio:** en esa misma pantalla, *Custom domain*: `gpx.sogra.es` → Save. Cuando GitHub emita el certificado, marca **Enforce HTTPS**.
3. **DNS:** registro `CNAME` de `gpx` → `ikersolozabal.github.io` (en Cloudflare, en modo **DNS only**, nube gris, hasta que el certificado esté emitido).
4. **Recomendado:** verificar el dominio en tu perfil (Settings → Pages → *Add a domain*) para que nadie más pueda usar `gpx.sogra.es` en otro repo.
5. **Primera publicación:** Actions → *Producción (GitHub Pages)* → *Run workflow* en `main`, o haz merge de un PR a `main`.

GitHub Pages en repositorios privados necesita un plan de pago; con el plan gratuito el repositorio tiene que ser público.

### Configuración de producción

Ya no hay `.env.pro`: se usan las **variables del repositorio** (Settings → Secrets and variables → Actions → pestaña *Variables*), con los mismos nombres que [`.env.pro.example`](.env.pro.example), por ejemplo `BIKE_SPEED_KMH=27`. Un cambio de variable se aplica en la siguiente publicación (merge a `main` o *Run workflow*).

Diferencias con Docker: GitHub Pages no permite cabeceras HTTP propias, así que la CSP va como `<meta>` en el HTML, y la no indexación de pre no aplica porque pre sigue en la VM.

### Buscadores

El build de producción añade `canonical`, Open Graph con URLs absolutas, `sitemap.xml` y la línea `Sitemap:` en `robots.txt`. La página lleva datos estructurados (`WebApplication`) y un texto con preguntas frecuentes que Google puede leer. Pre nunca se indexa.

Para darla de alta en Google: [Search Console](https://search.google.com/search-console) → Añadir propiedad → *Dominio* `gpx.sogra.es` → verificar con el registro TXT en el DNS → Sitemaps → `https://gpx.sogra.es/sitemap.xml`.

### Plan B: producción en Docker

La CI sigue publicando la imagen `:latest` desde `main`. Si algún día quieres volver a servir producción desde la VM, levanta el servicio `web` de `compose.yml` y apunta `gpx.sogra.es` al puerto 8080.

## Preproducción en la VM Linux

### 1. Preparar la VM (una vez)

- Docker Engine con el plugin Compose v2 (2.24 o superior).
- DNS: registro `A` de `pre.gpx.sogra.es` hacia tu IP pública.

### 2. Descargar la configuración

```bash
git clone -b develop https://github.com/IkerSolozabal/gpx-weather-ride.git /opt/gpx-weather-ride
cd /opt/gpx-weather-ride
cp .env.example .env            # puertos e imágenes
cp .env.pre.example .env.pre    # configuración de preproducción
```

En la VM solo hacen falta `compose.yml` y los `.env`: el código va dentro de la imagen.

Si el proxy inverso está en otra máquina (por ejemplo, el Synology), pon `PRE_BIND=0.0.0.0` en `.env` para que pueda llegar al puerto, y limita ese puerto en el cortafuegos de la VM a la IP del proxy.

### 3. Acceso a las imágenes de GHCR

Las imágenes se publican en `ghcr.io/ikersolozabal/gpx-weather-ride`. Elige una opción:

- **Hacer público el paquete** (lo más sencillo): GitHub → tu perfil → Packages → `gpx-weather-ride` → Package settings → Change visibility → Public.
- **Mantenerlo privado** e iniciar sesión en la VM con un token personal (classic) con permiso `read:packages`:
  ```bash
  echo <TOKEN> | docker login ghcr.io -u IkerSolozabal --password-stdin
  ```

### 4. Arrancar y actualizar

```bash
docker compose pull web-pre
docker compose up -d web-pre
docker compose ps                 # debe salir "healthy"
curl -s localhost:8081/healthz    # ok
```

Para actualizar tras un merge en `develop`, repite `pull` y `up -d`.

### 5. Proxy inverso con HTTPS

- **Synology (DSM):** Panel de control → Portal de inicio de sesión → Avanzado → Proxy inverso. Origen `HTTPS` · `pre.gpx.sogra.es` · `443` → destino `HTTP` · IP de la VM · `8081`. Asigna el certificado de Let's Encrypt de `pre.gpx.sogra.es`. Recomendado: un perfil de control de acceso que solo permita tu IP.
- **Caddy en la VM:** copia `deploy/Caddyfile.example` a `/etc/caddy/Caddyfile` y ejecuta `sudo systemctl reload caddy`.

### Alternativa: compilar en la VM sin GHCR

```bash
git clone -b develop https://github.com/IkerSolozabal/gpx-weather-ride.git /opt/gpx-pre
cd /opt/gpx-pre && cp .env.example .env && cp .env.pre.example .env.pre
docker compose -f compose.yml -f compose.build.yml up -d --build web-pre

# Actualizar
git pull && docker compose -f compose.yml -f compose.build.yml up -d --build web-pre
```

## Configuración de producción

Ya no hay `.env.pro`: se usan las **variables del repositorio** (Settings → Secrets and variables → Actions → pestaña *Variables*), con los mismos nombres que [`.env.pro.example`](.env.pro.example), por ejemplo `BIKE_SPEED_KMH=27`. Un cambio de variable se aplica en la siguiente publicación (merge a `main` o *Run workflow*).

Diferencias con Docker: GitHub Pages no permite cabeceras HTTP propias, así que la CSP va como `<meta>` en el HTML, y la no indexación de pre no aplica porque pre sigue en la VM.

### Buscadores

El build de producción añade `canonical`, Open Graph con URLs absolutas, `sitemap.xml` y la línea `Sitemap:` en `robots.txt`. La página lleva datos estructurados (`WebApplication`) y un texto con preguntas frecuentes que Google puede leer. Pre nunca se indexa.

Para darla de alta en Google: [Search Console](https://search.google.com/search-console) → Añadir propiedad → *Dominio* `gpx.sogra.es` → verificar con el registro TXT en el DNS → Sitemaps → `https://gpx.sogra.es/sitemap.xml`.

### Plan B: producción en Docker

La CI sigue publicando la imagen `:latest` desde `main`. Si algún día quieres volver a servir producción desde la VM, levanta el servicio `web` de `compose.yml` y apunta `gpx.sogra.es` al puerto 8080.

## Preproducción en la VM Linux

### 1. Preparar la VM (una vez)

- Docker Engine con el plugin Compose v2 (2.24 o superior).
- DNS: registros `A` de `gpx.sogra.es` y `pre.gpx.sogra.es` hacia la IP pública de la VM.
- Puertos 80 y 443 abiertos hacia la VM. Los contenedores solo escuchan en `127.0.0.1:8080` y `127.0.0.1:8081`.

### 2. Descargar la configuración

```bash
git clone https://github.com/IkerSolozabal/gpx-weather-ride.git /opt/gpx-weather-ride
cd /opt/gpx-weather-ride
cp .env.example .env            # puertos e imágenes
cp .env.pro.example .env.pro    # configuración de producción
cp .env.pre.example .env.pre    # configuración de preproducción
```

En la VM solo hacen falta `compose.yml` y los `.env`: el código va dentro de la imagen.

### 3. Acceso a las imágenes de GHCR

Las imágenes se publican en `ghcr.io/ikersolozabal/gpx-weather-ride`. Elige una opción:

- **Hacer público el paquete** (lo más sencillo): GitHub → tu perfil → Packages → `gpx-weather-ride` → Package settings → Change visibility → Public.
- **Mantenerlo privado** e iniciar sesión en la VM con un token personal (classic) con permiso `read:packages`:
  ```bash
  echo <TOKEN> | docker login ghcr.io -u IkerSolozabal --password-stdin
  ```

### 4. Arrancar

```bash
docker compose pull
docker compose up -d
docker compose ps        # los dos servicios deben estar "healthy"
curl -s localhost:8080/config.js
```

### 5. Proxy inverso con HTTPS

La forma más simple es [Caddy](https://caddyserver.com/docs/install), que obtiene y renueva los certificados de Let's Encrypt solo. Copia `deploy/Caddyfile.example` a `/etc/caddy/Caddyfile` y ejecuta `sudo systemctl reload caddy`. El ejemplo incluye, comentado, cómo restringir `pre` a tu IP o con contraseña.

Si ya tienes nginx o Traefik en la VM, basta con dirigir `gpx.sogra.es` a `127.0.0.1:8080` y `pre.gpx.sogra.es` a `127.0.0.1:8081`.

### Alternativa: compilar en la VM sin GHCR

```bash
# Producción, desde un clon en la rama main
git clone -b main https://github.com/IkerSolozabal/gpx-weather-ride.git /opt/gpx-pro
cd /opt/gpx-pro && cp .env.example .env && cp .env.pro.example .env.pro
docker compose -f compose.yml -f compose.build.yml up -d --build web

# Preproducción, desde otro clon en la rama develop
git clone -b develop https://github.com/IkerSolozabal/gpx-weather-ride.git /opt/gpx-pre
cd /opt/gpx-pre && cp .env.example .env && cp .env.pre.example .env.pre
docker compose -f compose.yml -f compose.build.yml up -d --build web-pre

# Actualizar
git pull && docker compose -f compose.yml -f compose.build.yml up -d --build web   # o web-pre
```

## Configuración

Todo lo que puede cambiar va en variables de entorno. En Docker (pre) se leen al **arrancar** el contenedor: tras editar `.env.pre` basta con `docker compose up -d web-pre`, sin reconstruir la imagen. En GitHub Pages (pro) se leen de las variables del repositorio al publicar. El script `docker/entrypoint/40-app-config.sh` las convierte en `/config.js`, que lee el navegador.

La lista completa, con sus valores por defecto, está comentada en [`.env.pro.example`](.env.pro.example). En resumen:

| Grupo | Variables |
| --- | --- |
| General | `APP_NAME`, `APP_DEFAULT_LANG`, `ROBOTS_INDEX` |
| Meteo | `WEATHER_API_URL`, `WEATHER_API_KEY`, `WEATHER_MODELS`, `WEATHER_FORECAST_DAYS` |
| Mapa | `MAP_TILE_URL`, `MAP_TILE_ATTRIBUTION`, `MAP_MAX_ZOOM` |
| Cálculo | `ROUTE_SAMPLE_KM`, `ROUTE_MAX_SAMPLES`, `ROUTE_SEGMENT_M`, `GPX_MAX_FILE_MB` |
| Formulario | `DEFAULT_SPORT`, `BIKE_SPEED_KMH`, `RUN_PACE`, `BIKE_MARKER_KM`, `RUN_MARKER_KM` |
| Mejor hora de salida | `BEST_START_STEP_MIN`, `TEMP_COMFORT_MIN`, `TEMP_COMFORT_MAX` |
| Viento | `WIND_CALM_KMH`, `WIND_HEAD_ANGLE`, `WIND_TAIL_ANGLE` |
| Seguridad | `CSP_EXTRA_CONNECT` |
| Solo GitHub Pages | `SITE_URL` (por defecto `https://gpx.sogra.es`, para canonical y sitemap), `PAGES_CNAME` (opcional, escribe el archivo `CNAME`) |
| Compose (`.env`) | `PRO_BIND`, `PRO_PORT`, `PRE_BIND`, `PRE_PORT`, `PRO_IMAGE`, `PRE_IMAGE` |

`APP_ENV` lo fija `compose.yml` (`pro` o `pre`). En `pre` se muestra una franja de aviso, el título lleva "(pre)" y la web no se indexa (`X-Robots-Tag` y `robots.txt`).

> `WEATHER_API_KEY` llega al navegador, así que cualquiera puede verla. Solo hace falta con un plan de pago de Open-Meteo; para eso conviene añadir más adelante un pequeño proxy en el servidor.

## Límites conocidos

- **Velocidad constante.** En rutas con puertos la hora de paso se desvía. Próximo paso: ajustar por pendiente.
- **Open-Meteo gratuito:** uso no comercial y unas 10.000 consultas al día. Cada cálculo de ruta hace de 1 a 3 consultas.
- **Pronóstico:** hasta 16 días. Más allá de 3 a 5 días, el viento por tramos es orientativo.
- **Zona horaria:** las horas se muestran en la zona horaria del navegador.
- **Teselas de OpenStreetMap:** pensadas para uso moderado. Con mucho tráfico, cambia `MAP_TILE_URL` a otro proveedor.

## Ideas para siguientes versiones

- Velocidad ajustada por pendiente (subidas y bajadas), con un modelo para bici y otro para carrera.
- Sugerir la mejor hora de salida comparando varias.
- Compartir una ruta por enlace.
- Importar desde Strava o Ride with GPS.

## Licencia

[MIT](LICENSE).
