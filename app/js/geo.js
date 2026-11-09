// Coordonnées, GPX, distances, lune

export function fmtCoord(lat, lon, mode = 'ddm') {
  if (lat == null || lon == null) return '—';
  const h = (v, pos, neg) => (v >= 0 ? pos : neg);
  if (mode === 'dec') return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  const part = (v, pos, neg) => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const m = (a - d) * 60;
    if (mode === 'dms') {
      const mi = Math.floor(m);
      const s = (m - mi) * 60;
      return `${d}°${String(mi).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"${h(v, pos, neg)}`;
    }
    return `${d}°${m.toFixed(3).padStart(6, '0').replace('.', ',')}'${h(v, pos, neg)}`;
  };
  return `${part(lat, 'N', 'S')} · ${part(lon, 'E', 'W')}`;
}

// Accepte : "35.8036, -5.9822" · "35°48,214'N 5°58,930'W" · "N35 48.214 W005 58.930" · DMS
export function parseCoords(input) {
  if (!input) return null;
  let s = String(input).trim().toUpperCase()
    .replace(/[’′]/g, "'").replace(/[″”]/g, '"').replace(/(\d),(\d)/g, '$1.$2');
  // Décimal simple
  const dec = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (dec) return valid(+dec[1], +dec[2]);
  // Sépare latitude / longitude sur la lettre d'hémisphère
  const re = /([NS])?\s*(-?\d+(?:\.\d+)?)\s*[°\s]?\s*(\d+(?:\.\d+)?)?\s*'?\s*(\d+(?:\.\d+)?)?\s*"?\s*([NSEW])?/g;
  const parts = [];
  let m;
  while ((m = re.exec(s)) && parts.length < 2) {
    if (m[0].trim() === '') { re.lastIndex++; continue; }
    const hemi = m[1] || m[5] || null;
    let v = Math.abs(+m[2]) + (m[3] ? +m[3] / 60 : 0) + (m[4] ? +m[4] / 3600 : 0);
    if (+m[2] < 0) v = -v;
    parts.push({ v, hemi });
  }
  // préfixe E/W pour la longitude ("W005 58.930")
  const lonPrefix = s.match(/([EW])\s*\d/);
  if (parts.length === 2) {
    let [a, b] = parts;
    if (lonPrefix && !b.hemi) b.hemi = lonPrefix[1];
    let lat = a.v, lon = b.v;
    if (a.hemi === 'S') lat = -Math.abs(lat);
    if (b.hemi === 'W') lon = -Math.abs(lon);
    if (a.hemi === 'E' || a.hemi === 'W') { // ordre inversé
      [lat, lon] = [b.hemi === 'S' ? -Math.abs(b.v) : b.v, a.hemi === 'W' ? -Math.abs(a.v) : a.v];
    }
    return valid(lat, lon);
  }
  return null;
}
function valid(lat, lon) {
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export function haversine(a, b) {
  const R = 6371e3, toR = (x) => (x * Math.PI) / 180;
  const dLat = toR(b[0] - a[0]), dLon = toR(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function trackStats(pts) {
  if (!pts || pts.length < 2) return { distance_km: 0 };
  let d = 0, maxKn = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = haversine(pts[i - 1], pts[i]);
    d += seg;
    const t0 = pts[i - 1][2], t1 = pts[i][2];
    if (t0 && t1 && t1 > t0) {
      const kn = (seg / ((t1 - t0) / 1000)) * 1.94384;
      if (kn < 60) maxKn = Math.max(maxKn, kn);
    }
  }
  const start = pts[0][2], end = pts[pts.length - 1][2];
  let moving = 0;
  for (let i = 1; i < pts.length; i++) { const dt = (pts[i][2] || 0) - (pts[i - 1][2] || 0); if (dt > 0 && dt < 30 * 60000) moving += dt; }
  return {
    distance_km: +(d / 1000).toFixed(1),
    duration_min: start && end ? Math.round(moving / 60000) : null,
    max_speed_kn: maxKn ? +maxKn.toFixed(1) : null,
    start: start ? new Date(start).toISOString() : null,
    end: end ? new Date(end).toISOString() : null,
  };
}

// GPX (format exporté par le Humminbird Solix : "Exporter tout" depuis Mes données)
export function parseGPX(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Fichier GPX illisible');
  const num = (el, sel) => { const n = el.querySelector(sel); return n ? parseFloat(n.textContent) : null; };
  const txt = (el, sel) => { const n = el.querySelector(sel); return n ? n.textContent.trim() : ''; };
  const waypoints = [...doc.getElementsByTagName('wpt')].map((w) => ({
    lat: +w.getAttribute('lat'), lon: +w.getAttribute('lon'),
    name: txt(w, 'name') || 'Waypoint', notes: txt(w, 'desc') || txt(w, 'cmt'),
    depth: num(w, 'depth') ?? null, time: txt(w, 'time') || null,
  })).filter((w) => isFinite(w.lat) && isFinite(w.lon));
  const tracks = [...doc.getElementsByTagName('trk')].map((t) => {
    const pts = [...t.getElementsByTagName('trkpt')].map((p) => {
      const tm = p.getElementsByTagName('time')[0];
      return [+p.getAttribute('lat'), +p.getAttribute('lon'), tm ? Date.parse(tm.textContent) : null];
    }).filter((p) => isFinite(p[0]) && isFinite(p[1]));
    return { name: txt(t, 'name') || 'Track', points: pts };
  }).filter((t) => t.points.length > 1);
  // les routes deviennent aussi des tracks
  [...doc.getElementsByTagName('rte')].forEach((r) => {
    const pts = [...r.getElementsByTagName('rtept')].map((p) => [+p.getAttribute('lat'), +p.getAttribute('lon'), null]);
    if (pts.length > 1) tracks.push({ name: txt(r, 'name') || 'Route', points: pts });
  });
  return { waypoints, tracks };
}

const esc = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
export function buildGPX({ spots = [], track = null, name = 'Spartel' }) {
  const wpts = spots.map((s) => `  <wpt lat="${s.lat.toFixed(6)}" lon="${s.lon.toFixed(6)}">\n    <name>${esc(s.name).slice(0, 30)}</name>${s.notes ? `\n    <desc>${esc(s.notes)}</desc>` : ''}\n    <sym>Waypoint</sym>\n  </wpt>`).join('\n');
  const trk = track && track.length ? `  <trk><name>${esc(name)}</name><trkseg>\n${track.map((p) => `    <trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}">${p[2] ? `<time>${new Date(p[2]).toISOString()}</time>` : ''}</trkpt>`).join('\n')}\n  </trkseg></trk>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Spartel" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${esc(name)}</name></metadata>\n${wpts}\n${trk}\n</gpx>\n`;
}

// Simplifie un track (Douglas-Peucker léger) pour limiter la taille stockée
export function simplify(pts, max = 3000) {
  if (pts.length <= max) return pts;
  const step = Math.ceil(pts.length / max);
  return pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
}

export function moonPhase(date = new Date()) {
  const synodic = 29.53058867;
  const ref = Date.UTC(2000, 0, 6, 18, 14) / 86400000;
  const days = date.getTime() / 86400000 - ref;
  const age = ((days % synodic) + synodic) % synodic;
  const frac = age / synodic;
  let label;
  if (frac < 0.03 || frac > 0.97) label = 'Nouvelle lune';
  else if (frac < 0.22) label = 'Croissant montant';
  else if (frac < 0.28) label = 'Premier quartier';
  else if (frac < 0.47) label = 'Lune montante';
  else if (frac < 0.53) label = 'Pleine lune';
  else if (frac < 0.72) label = 'Lune descendante';
  else if (frac < 0.78) label = 'Dernier quartier';
  else label = 'Croissant descendant';
  return { age: +age.toFixed(1), illumination: Math.round((1 - Math.cos(2 * Math.PI * frac)) / 2 * 100), label };
}

export function windDir(deg) {
  if (deg == null) return '';
  return ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(deg / 45) % 8];
}

// Conditions (Open-Meteo, gratuit, sans clé) à une position et une heure données
export async function fetchConditions(lat, lon, when = new Date()) {
  const t = new Date(when);
  const daysAgo = Math.max(0, Math.ceil((Date.now() - t.getTime()) / 86400000));
  const past = Math.min(92, daysAgo + 1);
  const pick = (hourly, keys) => {
    if (!hourly?.time) return {};
    let best = 0, bestD = Infinity;
    hourly.time.forEach((iso, i) => { const d = Math.abs(Date.parse(iso + 'Z') - t.getTime()); if (d < bestD) { bestD = d; best = i; } });
    const o = {}; keys.forEach((k) => (o[k] = hourly[k]?.[best] ?? null)); return o;
  };
  const out = { moon: moonPhase(t) };
  try {
    const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,temperature_2m,cloud_cover&wind_speed_unit=kn&timezone=GMT&past_days=${past}&forecast_days=2`).then((r) => r.json());
    Object.assign(out, pick(w.hourly, ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'pressure_msl', 'temperature_2m', 'cloud_cover']));
  } catch (e) { /* hors ligne */ }
  try {
    const m = await fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,wave_direction,wave_period,sea_surface_temperature&timezone=GMT&past_days=${past}&forecast_days=2`).then((r) => r.json());
    Object.assign(out, pick(m.hourly, ['wave_height', 'wave_direction', 'wave_period', 'sea_surface_temperature']));
  } catch (e) { /* hors ligne */ }
  return out;
}

export async function fetchCurrent(lat, lon) {
  const out = { moon: moonPhase() };
  try {
    const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,pressure_msl&wind_speed_unit=kn`).then((r) => r.json());
    Object.assign(out, w.current || {});
  } catch (e) {}
  try {
    const m = await fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=wave_height,wave_period,sea_surface_temperature`).then((r) => r.json());
    Object.assign(out, m.current || {});
  } catch (e) {}
  return out;
}

// ---- Autres formats d'échange : KML (Google Earth, OpenCPN…) et CSV (tableur, autres applis) ----
export function buildKML({ spots = [], name = 'Spartel' }) {
  const pm = spots.map((s) => `  <Placemark><name>${esc(s.name)}</name>${s.notes ? `<description>${esc(s.notes)}</description>` : ''}<Point><coordinates>${s.lon.toFixed(6)},${s.lat.toFixed(6)},0</coordinates></Point></Placemark>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(name)}</name>\n${pm}\n</Document></kml>\n`;
}
export function buildCSV(spots = []) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['name', 'latitude', 'longitude', 'depth_min_m', 'depth_max_m', 'bottom', 'notes'].join(',')];
  spots.forEach((s) => rows.push([q(s.name), s.lat.toFixed(6), s.lon.toFixed(6), s.depth_min ?? '', s.depth_max ?? '', q(s.bottom), q(s.notes)].join(',')));
  return rows.join('\n') + '\n';
}
export function parseKML(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Fichier KML illisible');
  const waypoints = [], tracks = [];
  [...doc.getElementsByTagName('Placemark')].forEach((p) => {
    const name = p.getElementsByTagName('name')[0]?.textContent.trim() || 'Point';
    const notes = p.getElementsByTagName('description')[0]?.textContent.trim() || '';
    const pt = p.getElementsByTagName('Point')[0];
    const ls = p.getElementsByTagName('LineString')[0];
    const coords = (el) => (el?.getElementsByTagName('coordinates')[0]?.textContent || '').trim().split(/\s+/).map((c) => c.split(',').map(Number)).filter((c) => c.length >= 2 && isFinite(c[0]) && isFinite(c[1]));
    if (pt) { const c = coords(pt)[0]; if (c) waypoints.push({ name, notes, lat: c[1], lon: c[0], depth: null }); }
    if (ls) { const cs = coords(ls); if (cs.length > 1) tracks.push({ name, points: cs.map((c) => [c[1], c[0], null]) }); }
  });
  return { waypoints, tracks };
}
export function parseCSV(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (!lines.length) return { waypoints: [], tracks: [] };
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const split = (l) => { const out = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === sep && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()); };
  const head = split(lines[0]).map((h) => h.toLowerCase());
  const idx = (...names) => head.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
  const iN = idx('name', 'nom', 'label'), iLat = idx('lat', 'latitude'), iLon = idx('lon', 'lng', 'long', 'longitude'), iD = idx('depth', 'profondeur', 'depth_min'), iNotes = idx('notes', 'desc', 'comment');
  const hasHead = iLat >= 0 && iLon >= 0;
  const waypoints = [];
  (hasHead ? lines.slice(1) : lines).forEach((l, k) => {
    const c = split(l);
    let lat, lon;
    if (hasHead) { lat = parseFloat(c[iLat].replace(',', '.')); lon = parseFloat(c[iLon].replace(',', '.')); }
    else { const p = parseCoords(c.slice(1).join(' ')) || parseCoords(c.join(' ')); if (!p) return; lat = p.lat; lon = p.lon; }
    if (!isFinite(lat) || !isFinite(lon)) return;
    waypoints.push({ name: (hasHead && iN >= 0 ? c[iN] : c[0]) || `Point ${k + 1}`, lat, lon, depth: hasHead && iD >= 0 ? parseFloat(c[iD]) || null : null, notes: hasHead && iNotes >= 0 ? c[iNotes] : '' });
  });
  return { waypoints, tracks: [] };
}
export function parseAny(name, text) {
  const n = name.toLowerCase();
  if (n.endsWith('.kml')) return parseKML(text);
  if (n.endsWith('.csv') || n.endsWith('.txt')) return parseCSV(text);
  return parseGPX(text);
}
export function bearing(a, b) {
  const toR = (x) => (x * Math.PI) / 180, toD = (x) => (x * 180) / Math.PI;
  const y = Math.sin(toR(b[1] - a[1])) * Math.cos(toR(b[0]));
  const x = Math.cos(toR(a[0])) * Math.sin(toR(b[0])) - Math.sin(toR(a[0])) * Math.cos(toR(b[0])) * Math.cos(toR(b[1] - a[1]));
  return (toD(Math.atan2(y, x)) + 360) % 360;
}
