// Prévisions de pêche : météo marine 7 jours, marée, périodes solunaires, indice de pêche.
import SunCalc from 'https://esm.sh/suncalc@1.9.0';
import { moonPhase } from './geo.js';

const DAY = 86400000;

// Transit haut / bas de la lune : on échantillonne l'altitude toutes les 10 min
function moonTransits(date, lat, lon) {
  const start = new Date(date); start.setHours(0, 0, 0, 0);
  let max = { alt: -Infinity, t: null }, min = { alt: Infinity, t: null };
  for (let m = 0; m <= 1440; m += 10) {
    const t = new Date(start.getTime() + m * 60000);
    const a = SunCalc.getMoonPosition(t, lat, lon).altitude;
    if (a > max.alt) max = { alt: a, t };
    if (a < min.alt) min = { alt: a, t };
  }
  return { upper: max.t, lower: min.t };
}

export function solunar(date, lat, lon) {
  const tr = moonTransits(date, lat, lon);
  const mt = SunCalc.getMoonTimes(date, lat, lon);
  const st = SunCalc.getTimes(date, lat, lon);
  const span = (c, h) => (c ? { start: new Date(c.getTime() - h * 3600000), end: new Date(c.getTime() + h * 3600000), center: c } : null);
  return {
    major: [span(tr.upper, 1), span(tr.lower, 1)].filter(Boolean),
    minor: [span(mt.rise, 0.5), span(mt.set, 0.5)].filter(Boolean),
    sunrise: st.sunrise, sunset: st.sunset,
    moon: moonPhase(new Date(date.getTime() + DAY / 2)),
  };
}

// Indice de pêche 0–100 : lune + périodes solunaires à l'aube/crépuscule + météo pêchable
export function dayScore(day) {
  const m = day.sol.moon;
  const phase = Math.abs(m.illumination - 50) / 50; // 1 = pleine ou nouvelle lune
  let s = 40 + phase * 25;
  const nearLight = (p) => [day.sol.sunrise, day.sol.sunset].some((x) => x && Math.abs(p.center - x) < 2 * 3600000);
  if (day.sol.major.some(nearLight)) s += 15;
  if (day.sol.minor.some(nearLight)) s += 8;
  if (day.windMax != null) s -= Math.max(0, day.windMax - 14) * 2.2;
  if (day.waveMax != null) s -= Math.max(0, day.waveMax - 1.4) * 18;
  if (day.tideRange != null && day.tideRange > 0.6) s += 6;
  return Math.max(0, Math.min(100, Math.round(s)));
}

export async function forecast(lat, lon) {
  const [w, m] = await Promise.all([
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,temperature_2m,precipitation_probability&wind_speed_unit=kn&timezone=auto&forecast_days=7`).then((r) => r.json()),
    fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,wave_period,wave_direction,sea_surface_temperature,sea_level_height_msl,ocean_current_velocity,ocean_current_direction&timezone=auto&forecast_days=7&length_unit=metric`).then((r) => r.json()).catch(() => ({})),
  ]);
  if (!w.hourly) throw new Error(w.reason || 'Prévisions indisponibles');
  const H = w.hourly, M = m.hourly || {};
  const mi = {}; (M.time || []).forEach((t, i) => (mi[t] = i));
  const hours = H.time.map((t, i) => {
    const j = mi[t];
    return {
      t: new Date(t), wind: H.wind_speed_10m[i], dir: H.wind_direction_10m[i], gust: H.wind_gusts_10m[i], press: H.pressure_msl[i], air: H.temperature_2m[i], rain: H.precipitation_probability?.[i],
      wave: j != null ? M.wave_height?.[j] : null, period: j != null ? M.wave_period?.[j] : null, sst: j != null ? M.sea_surface_temperature?.[j] : null,
      tide: j != null ? M.sea_level_height_msl?.[j] : null, cur: j != null ? M.ocean_current_velocity?.[j] : null, curDir: j != null ? M.ocean_current_direction?.[j] : null,
    };
  });
  const days = [];
  for (let d = 0; d < 7; d++) {
    const hs = hours.slice(d * 24, d * 24 + 24);
    if (!hs.length) break;
    const date = new Date(hs[0].t); date.setHours(12);
    const day = (hs.filter((h) => h.t.getHours() >= 5 && h.t.getHours() <= 21));
    const nums = (k) => day.map((h) => h[k]).filter((x) => x != null);
    const max = (a) => (a.length ? Math.max(...a) : null), min = (a) => (a.length ? Math.min(...a) : null), avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const tides = hs.map((h) => h.tide).filter((x) => x != null);
    const o = {
      date, hours: hs, sol: solunar(date, lat, lon),
      windMax: max(nums('wind')), windAvg: avg(nums('wind')), gustMax: max(nums('gust')), waveMax: max(nums('wave')), sst: avg(nums('sst')),
      tideRange: tides.length ? max(tides) - min(tides) : null,
      dirAvg: avg(nums('dir')),
    };
    // pleines / basses mers approximatives
    o.tideEvents = [];
    for (let i = 1; i < hs.length - 1; i++) {
      const a = hs[i - 1].tide, b = hs[i].tide, c = hs[i + 1].tide;
      if (a == null || b == null || c == null) continue;
      if (b > a && b >= c) o.tideEvents.push({ type: 'high', t: hs[i].t, h: b });
      if (b < a && b <= c) o.tideEvents.push({ type: 'low', t: hs[i].t, h: b });
    }
    o.score = dayScore(o);
    days.push(o);
  }
  return days;
}
