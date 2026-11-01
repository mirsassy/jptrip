import { describe, it, expect } from 'vitest';
import { archiveRequest, computeTypical, parseForecast, refreshWeather, weatherFor, forecastUrl, wearAdvice, conditions, pastDaysFor } from '../../src/lib/weather.js';
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

  it('during the trip, asks for the days already past and labels them recorded', async () => {
    expect(pastDaysFor(range, '2030-03-01')).toBe(0);
    expect(pastDaysFor(range, '2030-03-10')).toBe(6);
    expect(forecastUrl(tokyo, 6)).toContain('past_days=6');
    expect(forecastUrl(tokyo)).not.toContain('past_days');
    expect(forecastUrl(tokyo)).toContain('apparent_temperature_max');
    const urls = [];
    const fetchJson = async (url) => {
      urls.push(url);
      if (url.includes('archive')) return { daily: { time: [] } };
      return { daily: { time: ['2030-03-09', '2030-03-10'], weather_code: [63, 1], temperature_2m_max: [50, 55], temperature_2m_min: [40, 42], apparent_temperature_max: [45, 52], apparent_temperature_min: [35, 39], precipitation_probability_max: [90, 10], precipitation_sum: [0.4, 0], wind_speed_10m_max: [12, 25] } };
    };
    const cache = await refreshWeather({}, [tokyo], range, { fetchJson, now: 1000, today: '2030-03-10' });
    expect(urls[0]).toContain('past_days=6');
    expect(weatherFor(cache, tokyo, '2030-03-09')).toMatchObject({ kind: 'recorded', precip: 0.4, code: 63 });
    expect(weatherFor(cache, tokyo, '2030-03-10')).toMatchObject({ kind: 'forecast', feelsHi: 52, wind: 25 });
    // During the trip the forecast is refreshed after an hour (before the trip: three hours)
    urls.length = 0;
    await refreshWeather(cache, [tokyo], range, { fetchJson, now: 1000 + 61 * 60 * 1000, today: '2030-03-10' });
    expect(urls.filter((u) => u.includes('api.open-meteo'))).toHaveLength(1);
    // A pull-down can ask for anything older than 10 minutes
    urls.length = 0;
    await refreshWeather(cache, [tokyo], range, { fetchJson, now: 1000 + 72 * 60 * 1000, today: '2030-03-10', maxAgeMs: 10 * 60 * 1000 });
    expect(urls).toHaveLength(1);
  });

  it('names the sky and says what to wear', () => {
    expect(conditions(0)).toBe('Clear');
    expect(conditions(63)).toBe('Rain');
    expect(conditions(73)).toBe('Snow');
    expect(wearAdvice({ hi: 52, lo: 40, feelsHi: 48, feelsLo: 34, rain: 80, wind: 8, kind: 'forecast' })).toBe('Warm coat and layers; bring an umbrella.');
    expect(wearAdvice({ hi: 66, lo: 50, rain: 35, wind: 22, kind: 'forecast' })).toBe('Long sleeves, with a jacket for the evening; bring a compact umbrella just in case and something windproof.');
    expect(wearAdvice({ hi: 35, lo: 25, code: 73, kind: 'forecast' })).toBe('Winter coat, hat and gloves; bring waterproof boots.');
    expect(wearAdvice({ hi: 60, lo: 46, rain: 20, kind: 'typical' })).toBe('Long sleeves, with a jacket for the evening.');
    expect(wearAdvice(null)).toBe('');
  });
});

