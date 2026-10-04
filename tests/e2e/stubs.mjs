// Network stubs for browser tests: Open-Meteo and OpenFreeMap are not reachable
// from the test environment, so they get small fixed responses.
import { addDays } from '../../src/lib/dates.js';

export function forecastFixture(url) {
  const u = new URL(url);
  const start = '2030-03-04'; // first day of the fictional test trip
  const time = Array.from({ length: 16 }, (_, i) => addDays(start, i));
  const lat = +u.searchParams.get('latitude');
  return {
    daily: {
      time,
      temperature_2m_max: time.map((_, i) => 60 + (lat % 1) * 10 + i * 0.1),
      temperature_2m_min: time.map(() => 48),
      precipitation_probability_max: time.map((_, i) => (i * 7) % 100),
    },
  };
}

export function archiveFixture(url) {
  const u = new URL(url);
  const time = [], hi = [], lo = [], p = [];
  for (let d = u.searchParams.get('start_date'); d <= u.searchParams.get('end_date'); d = addDays(d, 1)) {
    time.push(d); hi.push(59.4); lo.push(46.2); p.push(+d.slice(8) % 3 === 0 ? 4 : 0);
  }
  return { daily: { time, temperature_2m_max: hi, temperature_2m_min: lo, precipitation_sum: p } };
}

export const STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e8e4dc' } }],
};

export async function stubNetwork(target, calls = {}) {
  calls.forecast = 0; calls.archive = 0; calls.tiles = 0;
  await target.route('https://api.open-meteo.com/**', (r) => { calls.forecast++; r.fulfill({ json: forecastFixture(r.request().url()), headers: { 'Access-Control-Allow-Origin': '*' } }); });
  await target.route('https://archive-api.open-meteo.com/**', (r) => { calls.archive++; r.fulfill({ json: archiveFixture(r.request().url()), headers: { 'Access-Control-Allow-Origin': '*' } }); });
  await target.route('https://tiles.openfreemap.org/**', (r) => { calls.tiles++; r.fulfill({ json: STYLE, headers: { 'Access-Control-Allow-Origin': '*' } }); });
  return calls;
}
