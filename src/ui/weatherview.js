// Weather tab: every trip day's weather for the cities the family is in, as a daily list,
// week-by-week summaries, or month calendars. Uses the weather already kept on the device
// (recorded for past days, forecast, else typical), so it works offline too.
import { h, icon, clear } from './dom.js';
import { state, weatherLoc } from '../lib/store.js';
import { makePass, selectedPeople } from '../lib/filters.js';
import { weatherFor, conditions, wearAdvice } from '../lib/weather.js';
import { addDays, fmtDay, fmtShort, jpNow, ago } from '../lib/dates.js';

const MODES = [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']];
const MODE_KEY = 'trip.wxMode';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TAG = { forecast: 'Forecast', recorded: 'Recorded', typical: 'Typical' };

let mode = (() => { try { return localStorage.getItem(MODE_KEY) || 'daily'; } catch { return 'daily'; } })();
let jumpTo = null; // a day tapped in Weekly/Monthly: Daily scrolls to it

/** A small weather symbol from the conditions code, else (typical days) from the rain odds. */
export function symbol(w) {
  if (!w) return '·';
  const c = w.code;
  if (c !== null && c !== undefined) {
    if (c === 0) return '☀️';
    if (c <= 2) return '⛅';
    if (c === 3 || c === 45 || c === 48) return '☁️';
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return '❄️';
    if (c >= 95) return '⛈️';
    return '🌧️';
  }
  if (w.rain !== null && w.rain !== undefined && w.rain >= 50) return '🌧️';
  return w.hi >= 68 ? '☀️' : '⛅';
}

const wet = (w) => !!w && (w.kind === 'recorded' ? (w.precip ?? 0) >= 0.04 : (w.rain ?? 0) >= 50);

/** Where the family is each night (stays), plus cities they travel through that day, in trip order. */
function placesOn(m, date, pass, only) {
  const mine = (it) => pass(it) && it.status !== 'Cancelled' && (!only.length || it.people.some((p) => only.includes(p)));
  const out = [];
  const add = (city, stay) => { if (city && !out.some((x) => x.city.toLowerCase() === city.toLowerCase())) out.push({ city, stay }); };
  m.items.filter((it) => it.type === 'stay' && it.date <= date && date < it.endDate && mine(it)).forEach((st) => add(st.city, st));
  m.items.filter((it) => it.type === 'transport' && it.date === date && mine(it)).forEach((t) => t.cities.forEach((c) => add(c, null)));
  return out.map((p) => {
    const loc = weatherLoc(m, p.city, p.stay);
    return { ...p, w: loc ? weatherFor(state.weather, loc, date) : null };
  });
}

export function renderWeather(root) {
  clear(root);
  const m = state.model;
  if (!m.range) { root.append(h('p', { class: 'muted' }, 'No dates in the Sheet yet.')); return; }
  const pass = makePass(m, state.filters, { ignoreDates: true });
  const only = selectedPeople(m, state.filters);
  const today = jpNow().date;
  const days = [];
  for (let d = m.range.start; d <= m.range.end; d = addDays(d, 1)) days.push({ date: d, places: placesOn(m, d, pass, only) });

  const newest = Math.max(0, ...Object.values(state.weather.forecast || {}).map((f) => f.fetchedAt || 0));
  const tabs = h('div', { class: 'seg', role: 'group', 'aria-label': 'Weather view' }, MODES.map(([id, label]) => h('button', {
    type: 'button', 'aria-pressed': String(mode === id),
    onclick: () => { mode = id; try { localStorage.setItem(MODE_KEY, id); } catch { /* ignore */ } renderWeather(root); },
  }, label)));
  root.append(h('div', { class: 'wx-head' }, tabs,
    h('div', { class: 'small muted' }, newest ? `Forecast updated ${ago(newest)} · pull down to refresh` : 'Weather loads when online.'),
    h('div', { class: 'small muted wx-legend' },
      h('span', { class: 'wx' }, h('span', { class: 'tag recorded' }, 'Recorded')), ' what it was ',
      h('span', { class: 'wx' }, h('span', { class: 'tag forecast' }, 'Forecast')), ' next 16 days ',
      h('span', { class: 'wx' }, h('span', { class: 'tag typical' }, 'Typical')), ' 10-year average')));

  const open = (date) => { mode = 'daily'; jumpTo = date; try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ } renderWeather(root); };
  if (mode === 'weekly') renderWeekly(root, days, today, open);
  else if (mode === 'monthly') renderMonthly(root, days, today, open);
  else renderDaily(root, days, today);
}

/* ---------- Daily ---------- */
function renderDaily(root, days, today) {
  const list = h('div', { class: 'wx-days' });
  let target = null;
  days.forEach(({ date, places }) => {
    const card = h('section', { class: `card wx-day${date === today ? ' today' : ''}`, 'aria-label': fmtDay(date), dataset: { date } },
      h('h3', null, fmtDay(date), date === today ? h('span', { class: 'chip' }, 'Today') : null),
      places.length ? places.map((p) => cityRow(p)) : h('p', { class: 'small muted', style: { margin: 0 } }, 'No stay or travel this day.'),
      wearFor(places));
    if (date === (jumpTo || today)) target = card;
    list.append(card);
  });
  root.append(list);
  // Open on today during the trip (or the day tapped in Weekly/Monthly)
  if (target && (jumpTo || (today >= days[0].date && today <= days[days.length - 1].date))) {
    requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
  }
  jumpTo = null;
}

function cityRow({ city, w }) {
  if (!w) return h('div', { class: 'wx-row' }, h('b', null, city), h('span', { class: 'muted small' }, ' weather not loaded yet'));
  const rain = w.kind === 'recorded'
    ? `${w.precip ? (w.precip >= 0.1 ? w.precip.toFixed(1) : '<0.1') : '0'} in rain`
    : w.rain === null || w.rain === undefined ? '' : w.kind === 'forecast' ? `${w.rain}% rain` : `rain ${w.rain}% of days`;
  const feels = w.feelsHi !== null && w.feelsHi !== undefined && (Math.abs(w.feelsHi - w.hi) >= 3 || Math.abs(w.feelsLo - w.lo) >= 3) ? `feels ${w.feelsHi}° / ${w.feelsLo}°` : '';
  return h('div', { class: 'wx-row' },
    h('span', { class: 'wx-sym', 'aria-hidden': 'true' }, symbol(w)),
    h('div', null,
      h('div', null, h('b', null, city), ' ', conditions(w.code) ? h('span', null, conditions(w.code)) : null),
      h('div', { class: 'small muted row', style: { gap: '2px 10px' } },
        h('span', null, h('b', { class: 'hi' }, `${w.hi}°`), ` / ${w.lo}°F`),
        feels ? h('span', null, feels) : null,
        rain ? h('span', null, rain) : null,
        w.wind !== null && w.wind !== undefined ? h('span', null, `wind ${w.wind} mph`) : null)),
    h('span', { class: 'wx' }, h('span', { class: `tag ${w.kind}` }, TAG[w.kind])));
}

function wearFor(places) {
  const seen = new Set();
  const lines = [];
  places.filter((p) => p.stay || places.length === 1).forEach((p) => {
    const t = wearAdvice(p.w);
    if (!t || seen.has(t)) return;
    seen.add(t);
    lines.push({ city: p.city, t, typical: p.w.kind === 'typical' });
  });
  return lines.map((l) => h('div', { class: 'wear small' }, lines.length > 1 ? h('span', { class: 'muted' }, `${l.city}: `) : null,
    h('b', null, l.typical ? 'Usually: ' : 'Wear: '), l.t));
}

/* ---------- Weekly ---------- */
/** One summary per week of the trip (weeks start on the trip's first day). */
function renderWeekly(root, days, today, openDaily) {
  for (let i = 0; i < days.length; i += 7) {
    const week = days.slice(i, i + 7);
    const all = week.flatMap((d) => d.places.filter((p) => p.w));
    const cities = [...new Set(week.flatMap((d) => d.places.filter((p) => p.stay).map((p) => p.city)))];
    const head = h('h3', null, `Week ${i / 7 + 1} · ${fmtShort(week[0].date)} – ${fmtShort(week[week.length - 1].date)}`);
    if (!all.length) { root.append(h('section', { class: 'card' }, head, h('p', { class: 'small muted' }, 'No weather yet.'))); continue; }
    const warm = all.reduce((a, b) => (b.w.hi > a.w.hi ? b : a));
    const cold = all.reduce((a, b) => (b.w.lo < a.w.lo ? b : a));
    const wetDays = week.filter((d) => d.places.some((p) => wet(p.w))).length;
    // Pack for the coldest day of the week
    const coldest = all.reduce((a, b) => ((b.w.feelsLo ?? b.w.lo) < (a.w.feelsLo ?? a.w.lo) ? b : a));
    root.append(h('section', { class: 'card wx-week' }, head,
      cities.length ? h('div', { class: 'small muted' }, cities.join(' → ')) : null,
      h('div', { class: 'wx-strip' }, week.map((d) => {
        const p = d.places.find((x) => x.stay && x.w) || d.places.find((x) => x.w);
        return h('button', { type: 'button', class: `wx-cell${d.date === today ? ' today' : ''}`, 'aria-label': `${fmtDay(d.date)} weather`, onclick: () => openDaily(d.date) },
          h('span', { class: 'small muted' }, WEEKDAYS[new Date(`${d.date}T00:00:00Z`).getUTCDay()]),
          h('span', { class: 'small' }, String(+d.date.slice(8))),
          h('span', { class: 'wx-sym', 'aria-hidden': 'true' }, symbol(p?.w)),
          p ? h('span', { class: 'hi' }, `${p.w.hi}°`) : h('span', { class: 'muted' }, '–'),
          p ? h('span', { class: 'small muted' }, `${p.w.lo}°`) : null,
          p && wet(p.w) ? h('span', { class: 'small', title: 'Rain likely' }, '☂') : h('span', { class: 'small' }, ' '));
      })),
      h('ul', { class: 'wx-facts small' },
        h('li', null, `Warmest ${warm.w.hi}°F (${warm.city}), coldest ${cold.w.lo}°F (${cold.city})`),
        h('li', null, wetDays ? `Rain likely on ${wetDays} of ${week.length} days` : 'Little rain expected'),
        h('li', null, h('b', null, 'Pack for: '), wearAdvice(coldest.w)))));
  }
}

/* ---------- Monthly ---------- */
function renderMonthly(root, days, today, openDaily) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  let cursor = `${days[0].date.slice(0, 7)}-01`;
  const last = days[days.length - 1].date.slice(0, 7);
  while (cursor.slice(0, 7) <= last) {
    const [y, mo] = cursor.split('-').map(Number);
    const grid = h('div', { class: 'mgrid wx-mgrid', role: 'grid', 'aria-label': `${MONTHS[mo - 1]} ${y} weather` },
      WEEKDAYS.map((w) => h('div', { class: 'mhead', role: 'columnheader' }, w)));
    for (let i = 0; i < new Date(`${cursor}T00:00:00Z`).getUTCDay(); i++) grid.append(h('div', { class: 'mcell empty' }));
    const inMonth = [];
    for (let d = cursor; d.slice(0, 7) === cursor.slice(0, 7); d = addDays(d, 1)) {
      const day = byDate.get(d);
      const p = day && (day.places.find((x) => x.stay && x.w) || day.places.find((x) => x.w));
      if (p) inMonth.push(p);
      grid.append(day
        ? h('button', { type: 'button', class: `mcell wx-mcell${d === today ? ' today' : ''}`, 'aria-label': `${fmtDay(d)} weather`, onclick: () => openDaily(d) },
          h('span', { class: 'mnum' }, String(+d.slice(8))),
          h('span', { class: 'wx-sym', 'aria-hidden': 'true' }, symbol(p?.w)),
          p ? h('span', null, h('b', { class: 'hi' }, `${p.w.hi}°`), h('span', { class: 'muted' }, ` ${p.w.lo}°`)) : null,
          p ? h('span', { class: 'small muted wx-mcity' }, p.city) : null)
        : h('div', { class: 'mcell out' }, h('span', { class: 'mnum' }, String(+d.slice(8)))));
    }
    const avg = (f) => Math.round(inMonth.reduce((s, p) => s + f(p.w), 0) / inMonth.length);
    root.append(h('section', { class: 'card month' }, h('h2', { class: 'mtitle' }, `${MONTHS[mo - 1]} ${y}`),
      inMonth.length ? h('p', { class: 'small muted', style: { margin: '0 0 8px' } },
        `Average ${avg((w) => w.hi)}° / ${avg((w) => w.lo)}°F · range ${Math.min(...inMonth.map((p) => p.w.lo))}° to ${Math.max(...inMonth.map((p) => p.w.hi))}° · rain likely on ${inMonth.filter((p) => wet(p.w)).length} of ${inMonth.length} days`) : null,
      grid));
    cursor = `${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, '0')}-01`;
  }
}
