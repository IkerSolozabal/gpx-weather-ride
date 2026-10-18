/**
 * GPX para el GPS (Garmin, Wahoo…): el track de la ruta y un waypoint en cada
 * punto kilométrico con la hora de paso y la meteo, marcado con «!» si hay
 * algo a vigilar (lluvia, rachas fuertes o viento fuerte en contra).
 */

export const ALERT = Object.freeze({ rainProb: 50, gustsKmh: 45, headKmh: 20 });

const xml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Avisos de un punto: lista de claves ('rain', 'gusts', 'head'). */
export function alertsFor(marker, limits = ALERT) {
  const w = marker.weather;
  if (!w) return [];
  const out = [];
  if (w.precipProb >= limits.rainProb) out.push('rain');
  if (w.gusts >= limits.gustsKmh) out.push('gusts');
  if (marker.rel && marker.rel.head >= limits.headKmh) out.push('head');
  return out;
}

/**
 * @param {{track, plan, name, label: (marker, alerts) => {name, desc}}} opts
 *   `label` devuelve los textos ya traducidos de cada waypoint.
 */
export function buildGpx({ track, plan, name, label, creator = 'GPX Weather Ride' }) {
  const wpts = plan.markers
    .map((m) => {
      const alerts = alertsFor(m);
      const { name: wName, desc } = label(m, alerts);
      const ele = Number.isFinite(m.ele) ? `<ele>${m.ele.toFixed(1)}</ele>` : '';
      return `  <wpt lat="${m.lat.toFixed(6)}" lon="${m.lon.toFixed(6)}">${ele}<time>${iso(m.time)}</time><name>${xml(wName)}</name><desc>${xml(desc)}</desc><sym>${alerts.length ? 'Danger Area' : 'Flag, Blue'}</sym></wpt>`;
    })
    .join('\n');
  const trkpts = track.points
    .map((p) => `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${Number.isFinite(p.ele) ? `<ele>${p.ele.toFixed(1)}</ele>` : ''}</trkpt>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="${xml(creator)}" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${xml(name)}</name><time>${iso(plan.startMs)}</time></metadata>
${wpts}
  <trk>
    <name>${xml(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}

/** Nombre de archivo seguro a partir del nombre de la ruta. */
export function fileName(name, ext) {
  const base = String(name || 'ruta')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60);
  return `${base || 'ruta'}.${ext}`;
}
