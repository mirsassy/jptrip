// Weather from Open-Meteo (free, no key), for each city on the trip:
// - Days already past (during the trip): what the weather actually was ("Recorded"),
//   from the forecast service's recent-days data (past_days).
// - Today and the next 15 days: the forecast, refreshed hourly during the trip.
// - Any other date: "typical" weather, the average of the same calendar dates (±3 days)
//   over the 10 years before the trip, from the historical archive.
// The forecast horizon is not assumed: whatever dates the response contains are used.
import { addDays, diffDays } from './dates.js';

export const FORECAST_TTL_MS = 3 * 3600 * 1000;      // before the trip
export const TRIP_FORECAST_TTL_MS = 3600 * 1000;      // during the trip
const MAX_PAST_DAYS = 92;                             // the most the service gives
const TYPICAL_YEARS = 10;
const WINDOW_DAYS = 3;
const RAIN_DAY_MM = 1.0;

const r2 = (x) => Math.round(x * 100) / 100;
export const locKey = (loc) => `${r2(loc.lat).toFixed(2)},${r2(loc.lng).toFixed(2)}`;

export function forecastUrl(loc, pastDays = 0) {
  const p = new URLSearchParams({
    latitude: r2(loc.lat), longitude: r2(loc.lng),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max',
    temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch', timezone: 'Asia/Tokyo', forecast_days: '16',
  });
  if (pastDays > 0) p.set('past_days', String(Math.min(MAX_PAST_DAYS, pastDays)));
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

/** Days of the trip already over (they get recorded weather), 0 before the trip. */
export function pastDaysFor(range, today) {
  if (!range || !today || today <= range.start) return 0;
  return Math.min(MAX_PAST_DAYS, diffDays(range.start, today));
}

/** One archive request covering the trip window in each of the 10 previous years. */
export function archiveRequest(loc, range) {
  // e.g. a trip Mar 4–27, 2030 -> 2020-03-01 .. 2029-03-30, which contains that window in each of 2020–2029
  const from = addDays(range.start, -WINDOW_DAYS);
  const to = addDays(range.end, WINDOW_DAYS);
  const start = `${+from.slice(0, 4) - TYPICAL_YEARS}${from.slice(4)}`;
  const end = `${+to.slice(0, 4) - 1}${to.slice(4)}`;
  const p = new URLSearchParams({
    latitude: r2(loc.lat), longitude: r2(loc.lng), start_date: start, end_date: end,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
    temperature_unit: 'fahrenheit', timezone: 'Asia/Tokyo',
  });
  return { url: `https://archive-api.open-meteo.com/v1/archive?${p}`, start, end };
}

export function parseForecast(json) {
  const d = json?.daily;
  const days = {};
  const at = (k, i) => { const v = d[k]?.[i]; return v === null || v === undefined ? null : v; };
  const round = (v) => (v === null ? null : Math.round(v));
  (d?.time || []).forEach((t, i) => {
    const hi = at('temperature_2m_max', i), lo = at('temperature_2m_min', i);
    if (hi === null) return;
    days[t] = {
      hi: Math.round(hi), lo: Math.round(lo),
      rain: at('precipitation_probability_max', i),
      code: at('weather_code', i),
      feelsHi: round(at('apparent_temperature_max', i)), feelsLo: round(at('apparent_temperature_min', i)),
      precip: at('precipitation_sum', i),
      wind: round(at('wind_speed_10m_max', i)),
    };
  });
  return days;
}

/** Plain words for the WMO weather code the service returns. */
export function conditions(code) {
  if (code === null || code === undefined) return '';
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Cloudy';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code === 61 || code === 80) return 'Light rain';
  if (code === 63 || code === 81) return 'Rain';
  if (code === 65 || code === 82 || code === 66 || code === 67) return 'Heavy rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'Snow';
  if (code >= 95) return 'Thunderstorms';
  return '';
}

const SNOWY = (c) => (c >= 71 && c <= 77) || c === 85 || c === 86;
const WET = (c) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;

/**
 * One line on what to wear, from the feels-like temperatures (else the actual ones), the chance
 * of rain or snow, wind, and the day's temperature swing. Typical-weather days get the same advice
 * from the 10-year averages.
 */
export function wearAdvice(w) {
  if (!w) return '';
  const hi = w.feelsHi ?? w.hi, lo = w.feelsLo ?? w.lo;
  let base;
  if (hi < 40 || lo <= 28) base = 'Winter coat, hat and gloves';
  else if (hi < 50) base = 'Warm coat and layers';
  else if (hi < 60) base = lo < 45 ? 'Jacket and a warm layer; colder after dark' : 'Light jacket or sweater';
  else if (hi < 70) base = lo < 52 ? 'Long sleeves, with a jacket for the evening' : 'Long sleeves or a light layer';
  else if (hi < 80) base = lo < 60 ? 'T-shirt by day, a light layer at night' : 'T-shirt weather';
  else base = 'Light, breathable clothes and a sun hat';
  const extra = [];
  if (w.code !== null && w.code !== undefined && SNOWY(w.code)) extra.push('waterproof boots');
  const rain = w.rain;
  if ((rain !== null && rain !== undefined && rain >= 50) || (w.code !== null && w.code !== undefined && WET(w.code) && w.kind !== 'typical')) extra.push('an umbrella');
  else if (rain !== null && rain !== undefined && rain >= 30) extra.push('a compact umbrella just in case');
  if (w.wind >= 20) extra.push('something windproof');
  if (hi - lo >= 18 && !/layer/i.test(base)) extra.push('layers for the big temperature swing');
  return extra.length ? `${base}; bring ${extra.join(', ').replace(/, ([^,]*)$/, ' and $1')}.` : `${base}.`;
}

/** Typical weather for each month-day in the trip window. */
export function computeTypical(json, range) {
  const d = json?.daily;
  if (!d?.time) return {};
  const byMd = new Map();
  d.time.forEach((t, i) => {
    const hi = d.temperature_2m_max[i], lo = d.temperature_2m_min[i], p = d.precipitation_sum[i];
    if (hi === null || lo === null) return;
    const md = t.slice(5);
    if (!byMd.has(md)) byMd.set(md, []);
    byMd.get(md).push({ year: t.slice(0, 4), hi, lo, wet: p !== null && p >= RAIN_DAY_MM });
  });
  const out = {};
  for (let day = range.start; day <= range.end; day = addDays(day, 1)) {
    const samples = [];
    for (let k = -WINDOW_DAYS; k <= WINDOW_DAYS; k++) samples.push(...(byMd.get(addDays(day, k).slice(5)) || []));
    if (!samples.length) continue;
    const avg = (f) => samples.reduce((s, x) => s + f(x), 0) / samples.length;
    out[day.slice(5)] = {
      hi: Math.round(avg((x) => x.hi)),
      lo: Math.round(avg((x) => x.lo)),
      rain: Math.round((100 * samples.filter((x) => x.wet).length) / samples.length),
      years: new Set(samples.map((x) => x.year)).size,
    };
  }
  return out;
}

/** Looks up the best weather we have for a place and date: recorded (past days), forecast, else typical. */
export function weatherFor(cache, loc, date) {
  if (!loc || !date) return null;
  const k = locKey(loc);
  const fc = cache.forecast?.[k];
  if (fc?.days?.[date]) return { ...fc.days[date], kind: fc.days[date].rec ? 'recorded' : 'forecast', fetchedAt: fc.fetchedAt };
  const ty = cache.typical?.[k];
  if (ty?.days?.[date.slice(5)]) return { ...ty.days[date.slice(5)], kind: 'typical' };
  return null;
}

/**
 * Fetches what is missing or stale. `cache` is mutated and returned; the caller persists it.
 * `fetchJson` is injectable for tests.
 */
export async function refreshWeather(cache, locs, range, { fetchJson, now = Date.now(), today = '', maxAgeMs } = {}) {
  cache.forecast ||= {};
  cache.typical ||= {};
  const uniq = new Map(locs.filter(Boolean).map((l) => [locKey(l), l]));
  const tasks = [];
  const during = today && today >= range.start && today <= addDays(range.end, 1);
  const ttl = maxAgeMs ?? (during ? TRIP_FORECAST_TTL_MS : FORECAST_TTL_MS);
  const past = pastDaysFor(range, today);
  uniq.forEach((loc, k) => {
    const fc = cache.forecast[k];
    // Refetch when old, or when a new day has passed since (so yesterday gets its recorded weather)
    if (!fc || now - fc.fetchedAt > ttl || (fc.pastDays ?? 0) < past) {
      tasks.push(fetchJson(forecastUrl(loc, past)).then((j) => {
        // Recorded days already kept stay (the service only gives the last 92 days)
        const days = parseForecast(j);
        Object.keys(days).forEach((t) => { if (today && t < today) days[t].rec = true; }); // already happened: recorded, not forecast
        cache.forecast[k] = { fetchedAt: now, pastDays: past, days: { ...(fc?.days || {}), ...days } };
      }).catch(() => {}));
    }
    const ty = cache.typical[k];
    const covered = ty && ty.rangeStart <= range.start.slice(5) && ty.rangeEnd >= range.end.slice(5) && ty.tripYear === range.start.slice(0, 4);
    if (!covered) {
      const req = archiveRequest(loc, range);
      tasks.push(fetchJson(req.url).then((j) => {
        cache.typical[k] = { fetchedAt: now, tripYear: range.start.slice(0, 4), rangeStart: range.start.slice(5), rangeEnd: range.end.slice(5), days: computeTypical(j, range) };
      }).catch(() => {}));
    }
  });
  await Promise.all(tasks);
  cache.fetched = tasks.length; // how many downloads this call made (0 = nothing new)
  return cache;
}
