// Weather from Open-Meteo (free, no key). Dates the forecast covers show the
// forecast; any other date shows "typical" weather: the average of the same
// calendar dates (±3 days) over the 10 years before the trip, from the
// historical archive. The forecast horizon is not assumed: whatever dates the
// forecast response contains are treated as forecast.
import { addDays } from './dates.js';

export const FORECAST_TTL_MS = 3 * 3600 * 1000;
const TYPICAL_YEARS = 10;
const WINDOW_DAYS = 3;
const RAIN_DAY_MM = 1.0;

const r2 = (x) => Math.round(x * 100) / 100;
export const locKey = (loc) => `${r2(loc.lat).toFixed(2)},${r2(loc.lng).toFixed(2)}`;

export function forecastUrl(loc) {
  const p = new URLSearchParams({
    latitude: r2(loc.lat), longitude: r2(loc.lng),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    temperature_unit: 'fahrenheit', timezone: 'Asia/Tokyo', forecast_days: '16',
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
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
  (d?.time || []).forEach((t, i) => {
    const hi = d.temperature_2m_max?.[i], lo = d.temperature_2m_min?.[i];
    if (hi === null || hi === undefined) return;
    days[t] = { hi: Math.round(hi), lo: Math.round(lo), rain: d.precipitation_probability_max?.[i] ?? null };
  });
  return days;
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

/** Looks up the best weather we have for a place and date. */
export function weatherFor(cache, loc, date) {
  if (!loc || !date) return null;
  const k = locKey(loc);
  const fc = cache.forecast?.[k];
  if (fc?.days?.[date]) return { ...fc.days[date], kind: 'forecast', fetchedAt: fc.fetchedAt };
  const ty = cache.typical?.[k];
  if (ty?.days?.[date.slice(5)]) return { ...ty.days[date.slice(5)], kind: 'typical' };
  return null;
}

/**
 * Fetches what is missing or stale. `cache` is mutated and returned; the caller persists it.
 * `fetchJson` is injectable for tests.
 */
export async function refreshWeather(cache, locs, range, { fetchJson, now = Date.now() } = {}) {
  cache.forecast ||= {};
  cache.typical ||= {};
  const uniq = new Map(locs.filter(Boolean).map((l) => [locKey(l), l]));
  const tasks = [];
  uniq.forEach((loc, k) => {
    const fc = cache.forecast[k];
    if (!fc || now - fc.fetchedAt > FORECAST_TTL_MS) {
      tasks.push(fetchJson(forecastUrl(loc)).then((j) => { cache.forecast[k] = { fetchedAt: now, days: parseForecast(j) }; }).catch(() => {}));
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
  return cache;
}
