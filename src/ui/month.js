// Month view: a calendar of the trip showing, for each night, where people sleep
// (city, hotel) and who is there, reservations and flights (tap one to see it, tap the day to open it), followed by a list of every stay with its dates and people.
import { h, icon, clear } from './dom.js';
import { state, setDate } from '../lib/store.js';
import { dayGroups } from '../lib/model.js';
import { makePass, selectedPeople } from '../lib/filters.js';
import { addDays, fmtShort, jpNow } from '../lib/dates.js';
import { whoChips } from './common.js';
import { openItemView } from './item.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n) => String(n).padStart(2, '0');
const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

function dots(m, names) {
  if (names.length === m.people.length && names.length > 1) return h('span', { class: 'mdots all', title: 'Everyone' }, 'All');
  return h('span', { class: 'mdots', title: names.join(', ') }, names.map((n) => h('span', { class: 'dot', style: { background: m.peopleByName.get(n)?.color || '#888' } })));
}

/** A short name for an airport or station: its code when the name has one ("Haneda (HND)" → HND), else its first word. */
export function placeCode(name) {
  const code = String(name).match(/\b[A-Z]{3}\b/);
  return code ? code[0] : String(name).trim().split(/[\s,]+/)[0];
}

const isFlight = (it) => /flight|fly|plane|air/i.test(`${it.mode} ${it.carrier}`);

/** A tappable line inside a day cell: opens that plan, not the day. */
function detail(it, cls, ...content) {
  return h('button', { type: 'button', class: `mdetail ${cls}`, title: it.title, onclick: (e) => { e.stopPropagation(); openItemView(it); } }, ...content);
}

/** What a day cell shows: where each group sleeps (hotel, city, who), reservations, and flights with who is on them. */
function cellDetails(m, d, pass, only) {
  const out = [];
  const inScope = (it) => pass(it) && it.status !== 'Cancelled' && (!only.length || it.people.some((p) => only.includes(p)));
  m.items.filter((it) => it.type === 'transport' && it.date === d && isFlight(it) && inScope(it)).forEach((it) => {
    const names = it.people.length === m.people.length && it.people.length > 1 ? 'All' : it.people.join(', ');
    const route = [it.from, it.to].every(Boolean) ? ` (${placeCode(it.from)}→${placeCode(it.to)})` : '';
    out.push(detail(it, 'mflight', '✈ ', names, h('span', { class: 'mroute' }, route)));
  });
  dayGroups(m, d, { pass, onlyPeople: only }).forEach((g) => {
    if (g.stay) {
      const hotel = /^Stay in /.test(g.stay.title) ? '' : g.stay.title;
      out.push(detail(g.stay, 'mplace', h('span', { class: 'mcity' }, g.stay.city || g.stay.title), hotel ? h('span', { class: 'mhotel' }, hotel) : null, dots(m, g.people)));
    } else if (g.transit) {
      out.push(detail(g.transit, 'mplace', h('span', { class: 'mcity' }, 'Overnight travel'), dots(m, g.people)));
    }
  });
  m.items.filter((it) => it.type === 'reservation' && it.date === d && inScope(it)).sort((a, b) => (a.start || '').localeCompare(b.start || '')).forEach((it) => {
    out.push(detail(it, 'mres', it.title));
  });
  return out;
}

export function renderMonth(root) {
  clear(root);
  const m = state.model;
  if (!m.range) { root.append(h('p', { class: 'muted' }, 'No dates in the Sheet yet.')); return; }
  const pass = makePass(m, state.filters, { ignoreDates: true });
  const only = selectedPeople(m, state.filters);
  const today = jpNow().date;

  // One calendar per month the trip touches
  let cursor = `${m.range.start.slice(0, 7)}-01`;
  const lastMonth = m.range.end.slice(0, 7);
  while (cursor.slice(0, 7) <= lastMonth) {
    const [y, mo] = cursor.split('-').map(Number);
    const grid = h('div', { class: 'mgrid', role: 'grid', 'aria-label': `${MONTHS[mo - 1]} ${y}` },
      WEEKDAYS.map((w) => h('div', { class: 'mhead', role: 'columnheader' }, w)));
    for (let i = 0; i < weekday(cursor); i++) grid.append(h('div', { class: 'mcell empty' }));
    for (let d = cursor; d.slice(0, 7) === cursor.slice(0, 7); d = addDays(d, 1)) {
      const inTrip = d >= m.range.start && d <= m.range.end;
      const openDay = () => { setDate(d); location.hash = '#day'; };
      const cell = h('div', { class: `mcell${inTrip ? '' : ' out'}${d === today ? ' today' : ''}${d === state.date ? ' sel' : ''}`, role: 'button', tabindex: 0, 'aria-label': fmtShort(d),
        onclick: openDay, onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openDay(); } },
        h('span', { class: 'mnum' }, String(+d.slice(8))));
      if (inTrip) cellDetails(m, d, pass, only).forEach((el) => cell.append(el));
      grid.append(cell);
    }
    root.append(h('section', { class: 'card month' }, h('h2', { class: 'mtitle' }, `${MONTHS[mo - 1]} ${y}`), grid));
    cursor = `${mo === 12 ? y + 1 : y}-${pad(mo === 12 ? 1 : mo + 1)}-01`;
  }

  // Every stay in order: dates, place, who
  const stays = m.items.filter((it) => it.type === 'stay' && it.status !== 'Cancelled' && pass(it) && (!only.length || it.people.some((p) => only.includes(p))))
    .sort((a, b) => a.date.localeCompare(b.date) || a.city.localeCompare(b.city))
    // Same hotel and dates booked in several rows (e.g. per family): one line with everyone
    .reduce((acc, st) => {
      const same = acc.find((x) => x.lodging === st.lodging && x.date === st.date && x.endDate === st.endDate);
      if (same) same.people = m.people.map((p) => p.name).filter((n) => same.people.includes(n) || st.people.includes(n));
      else acc.push({ ...st, people: st.people.slice() });
      return acc;
    }, []);
  root.append(h('section', { class: 'card' },
    h('h2', { class: 'mtitle' }, 'Where everyone stays'),
    stays.length ? h('ul', { class: 'mstays' }, stays.map((s) => h('li', null,
      h('div', { class: 'mstay-when' }, `${fmtShort(s.date)} – ${fmtShort(s.endDate)}`),
      h('div', null, h('div', { style: { fontWeight: 600 } }, icon('stay', 16), ' ', s.city || s.title, s.city && s.title && s.title !== s.city && !/^Stay in /.test(s.title) ? h('span', { class: 'muted small' }, ` · ${s.title}`) : null),
        whoChips(s.people))))) : h('p', { class: 'muted' }, 'No stays yet.')));
}
