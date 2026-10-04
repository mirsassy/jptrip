// Month view: a calendar of the trip showing, for each night, where people sleep
// (city) and who is there, followed by a list of every stay with its dates and people.
import { h, icon, clear } from './dom.js';
import { state, setDate } from '../lib/store.js';
import { dayGroups } from '../lib/model.js';
import { makePass, selectedPeople } from '../lib/filters.js';
import { addDays, fmtShort, jpNow } from '../lib/dates.js';
import { whoChips } from './common.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n) => String(n).padStart(2, '0');
const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

function dots(m, names) {
  if (names.length === m.people.length && names.length > 1) return h('span', { class: 'mdots all', title: 'Everyone' }, 'All');
  return h('span', { class: 'mdots', title: names.join(', ') }, names.map((n) => h('span', { class: 'dot', style: { background: m.peopleByName.get(n)?.color || '#888' } })));
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
      const cell = h('button', { class: `mcell${inTrip ? '' : ' out'}${d === today ? ' today' : ''}${d === state.date ? ' sel' : ''}`, 'aria-label': fmtShort(d), onclick: () => { setDate(d); location.hash = '#day'; } },
        h('span', { class: 'mnum' }, String(+d.slice(8))));
      if (inTrip) {
        dayGroups(m, d, { pass, onlyPeople: only }).forEach((g) => {
          const place = g.stay ? (g.stay.city || g.stay.title) : g.transit ? 'In transit' : null;
          if (!place) return;
          cell.append(h('div', { class: 'mplace' }, h('span', { class: 'mcity' }, place), dots(m, g.people)));
        });
      }
      grid.append(cell);
    }
    root.append(h('section', { class: 'card month' }, h('h2', { class: 'mtitle' }, `${MONTHS[mo - 1]} ${y}`), grid));
    cursor = `${mo === 12 ? y + 1 : y}-${pad(mo === 12 ? 1 : mo + 1)}-01`;
  }

  // Every stay in order: dates, place, who
  const stays = m.items.filter((it) => it.type === 'stay' && it.status !== 'Cancelled' && pass(it) && (!only.length || it.people.some((p) => only.includes(p))))
    .sort((a, b) => a.date.localeCompare(b.date) || a.city.localeCompare(b.city));
  root.append(h('section', { class: 'card' },
    h('h2', { class: 'mtitle' }, 'Where everyone stays'),
    stays.length ? h('ul', { class: 'mstays' }, stays.map((s) => h('li', null,
      h('div', { class: 'mstay-when' }, `${fmtShort(s.date)} – ${fmtShort(s.endDate)}`),
      h('div', null, h('div', { style: { fontWeight: 600 } }, icon('stay', 16), ' ', s.city || s.title, s.city && s.title && s.title !== s.city && !/^Stay in /.test(s.title) ? h('span', { class: 'muted small' }, ` · ${s.title}`) : null),
        whoChips(s.people))))) : h('p', { class: 'muted' }, 'No stays yet.')));
}
