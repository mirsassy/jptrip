// "By plan": one day, condensed for the whole group: Travel, Lodging, Booked
// activities, Notes and Ideas. Rows that describe the same thing for different people
// (the same train, the same hotel booked per family) become one line listing everyone.
import { h, icon } from './dom.js';
import { state } from '../lib/store.js';
import { byTime } from '../lib/model.js';
import { fmtShort } from '../lib/dates.js';
import { whoChips, statusBadge, googleMapsLink, itemTimeLabel } from './common.js';
import { openItemView } from './item.js';
import { dayIdeas } from './ideas.js';

/** Merges items that are the same plan (by `keyOf`), combining their people. */
function merge(items, keyOf) {
  const out = new Map();
  items.forEach((it) => {
    const k = keyOf(it);
    if (!out.has(k)) out.set(k, { it, items: [it], people: it.people.slice() });
    else {
      const e = out.get(k);
      e.items.push(it);
      it.people.forEach((p) => { if (!e.people.includes(p)) e.people.push(p); });
    }
  });
  const order = state.model.people.map((p) => p.name);
  return [...out.values()].map((e) => ({ ...e, people: order.filter((n) => e.people.includes(n)) }));
}

export function renderPlan(root, date, { pass, only }) {
  const m = state.model;
  const mine = (it) => pass(it) && it.status !== 'Cancelled' && (!only.length || it.people.some((p) => only.includes(p)));
  const lc = (v) => String(v || '').trim().toLowerCase();

  const travel = merge(m.items.filter((it) => it.type === 'transport' && it.date === date && mine(it)).sort(byTime),
    (it) => [it.start, lc(it.mode), lc(it.from), lc(it.to), lc(it.carrier)].join('|'));
  const tonight = merge(m.items.filter((it) => it.type === 'stay' && it.date <= date && date < it.endDate && mine(it)), (it) => it.lodging || it.id);
  const leaving = merge(m.items.filter((it) => it.type === 'stay' && it.endDate === date && mine(it)), (it) => it.lodging || it.id)
    .filter((e) => !tonight.some((t) => (t.it.lodging || t.it.id) === (e.it.lodging || e.it.id)));
  const booked = merge(m.items.filter((it) => it.type === 'reservation' && it.date === date && mine(it)).sort(byTime),
    (it) => [it.start, lc(it.title)].join('|'));
  const notes = m.items.filter((it) => it.type === 'note' && it.date === date && mine(it));

  const section = (title, ic, rows, empty) => h('section', { class: 'card plan-day', 'aria-label': title },
    h('h3', { style: { marginTop: 0 } }, icon(ic, 18), ' ', title),
    rows.length ? h('ul', { class: 'plan-list' }, rows) : h('p', { class: 'small muted', style: { margin: 0 } }, empty));

  root.append(
    section('Travel', 'transport', travel.map((e) => row(e, itemTimeLabel(e.it), e.it.title, e.it.carrier)), 'No travel today.'),
    section('Lodging', 'stay', [
      ...tonight.map((e) => row(e, e.it.date === date ? 'Check-in' : 'Staying', hotelName(e.it), lodgingNote(e))),
      ...leaving.map((e) => row(e, 'Check-out', hotelName(e.it), e.it.city)),
    ], 'Nowhere booked for tonight.'),
    section('Booked activities', 'reservation', booked.map((e) => row(e, e.it.start || '', e.it.title, [e.it.kind, e.it.city].filter(Boolean).join(' · '))), 'Nothing booked today.'),
    notes.length ? section('Notes', 'note', notes.map((it) => row({ it, people: it.people }, '', it.title, it.city)), '') : null,
  );
  const cities = [];
  [...tonight, ...travel, ...booked].forEach((e) => e.it.cities.forEach((c) => { if (!cities.some((x) => lc(x) === lc(c))) cities.push(c); }));
  const ideas = dayIdeas(date, cities);
  root.append(ideas || section('Ideas', 'idea', [], 'No open ideas for today’s cities.'));
}

const hotelName = (it) => (/^Stay in /.test(it.title) ? it.city : it.title);

function lodgingNote(e) {
  const out = e.it.endDate ? `until ${fmtShort(e.it.endDate)}` : '';
  return [e.it.city, out, e.items.length > 1 ? `${e.items.length} bookings` : ''].filter(Boolean).join(' · ');
}

function row(e, when, title, sub) {
  const it = e.it;
  const maps = googleMapsLink(it);
  return h('li', null,
    h('div', { class: 'plan-when small muted' }, when),
    h('button', { class: 'plan-item', onclick: () => openItemView(it) },
      h('div', { class: 'ttl' }, title, it.status && it.status !== 'Confirmed' ? [' ', statusBadge(it.status)] : null),
      sub ? h('div', { class: 'small muted' }, sub) : null,
      it.type !== 'note' || it.who ? h('div', { style: { marginTop: '4px' } }, whoChips(e.people)) : null),
    maps ? h('a', { class: 'icon-btn', href: maps.href, target: '_blank', rel: 'noopener', 'aria-label': `${title} in Google Maps` }, icon('pin', 18)) : h('span'));
}
