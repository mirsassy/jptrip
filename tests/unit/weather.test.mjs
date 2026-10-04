import { describe, it, expect } from 'vitest';
import { archiveRequest, computeTypical, parseForecast, refreshWeather, weatherFor, forecastUrl } from '../../src/lib/weather.js';
import { addDays } from '../../src/lib/dates.js';

const tokyo = { lat: 35.6812, lng: 139.7671 };
const range = { start: '2030-03-04', end: '2030-03-27' };

/** Fake archive: every day hi 60F lo 45F, rain on even-numbered days of the month. */
function fakeArchive(start, end) {
  const time = [], hi = [], lo = [], p = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    time.push(d); hi.push(60); lo.push(45); p.push(+d.slice(8) % 2 === 0 ? 3 : 0);
  }
  return { daily: { time, temperature_2m_max: hi, temperature_2m_min: lo, precipitation_sum: p } };
}

describe('weather', () => {
  it('asks the archive for the trip window in each of the 10 previous years, in Fahrenheit', () => {
    const r = archiveRequest(tokyo, range);
    expect(r.start).toBe('2020-03-01');
    expect(r.end).toBe('2029-03-30');
    expect(r.url).toContain('temperature_unit=fahrenheit');
    expect(forecastUrl(tokyo)).toContain('forecast_days=16');
    expect(forecastUrl(tokyo)).toContain('precipitation_probability_max');
  });

  it('averages ±3 days over 10 years', () => {
    const t = computeTypical(fakeArchive('2020-03-01', '2029-03-30'), range);
    expect(t['03-15']).toEqual({ hi: 60, lo: 45, rain: 57, years: 10 }); // Mar 12–18: 4 of 7 days are even
    expect(Object.keys(t)).toHaveLength(24);
  });

  it('uses the forecast where it has the date, typical elsewhere', async () => {
    const fetchJson = async (url) => {
      if (url.includes('archive')) {
        const u = new URL(url);
        return fakeArchive(u.searchParams.get('start_date'), u.searchParams.get('end_date'));
      }
      return { daily: { time: ['2030-03-04', '2030-03-05'], temperature_2m_max: [64.4, 66], temperature_2m_min: [50, 51], precipitation_probability_max: [20, 70] } };
    };
    const cache = await refreshWeather({}, [tokyo], range, { fetchJson, now: 1000 });
    expect(weatherFor(cache, tokyo, '2030-03-05')).toMatchObject({ hi: 66, lo: 51, rain: 70, kind: 'forecast' });
    expect(weatherFor(cache, tokyo, '2030-03-20')).toMatchObject({ hi: 60, lo: 45, kind: 'typical' });

    // Fresh forecast and complete typical data: nothing is fetched again
    let calls = 0;
    await refreshWeather(cache, [tokyo], range, { fetchJson: async (u) => { calls++; return fetchJson(u); }, now: 2000 });
    expect(calls).toBe(0);
  });

  it('keeps the old data when offline', async () => {
    const cache = { forecast: { '35.68,139.77': { fetchedAt: 0, days: { '2030-03-04': { hi: 1, lo: 0, rain: 0 } } } } };
    await refreshWeather(cache, [tokyo], range, { fetchJson: async () => { throw new Error('offline'); }, now: 1e12 });
    expect(weatherFor(cache, tokyo, '2030-03-04').hi).toBe(1);
  });

  it('ignores empty forecast days', () => {
    expect(parseForecast({ daily: { time: ['2030-03-04'], temperature_2m_max: [null], temperature_2m_min: [null], precipitation_probability_max: [null] } })).toEqual({});
  });
});
