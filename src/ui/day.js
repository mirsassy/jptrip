import { h, icon, clear } from './dom.js';
import { state, setDate } from '../lib/store.js';
import { dayGroups, tripDays, whereabouts } from '../lib/model.js';
import { makePass, selectedPeople } from '../lib/filters.js';
import { addDays, fmtDay, jpNow } from '../lib/dates.js';
import { whoChips, statusBadge, weatherChip, googleMapsLink, itemTimeLabel, personChip } from './common.js';
import { openEditor } from './forms.js';
import { dayIdeas } from './ideas.js';
import { renderPlan } from './plan.js';

let mode = (() => { try { return localStorage.getItem('trip.dayMode') || 'group'; } catch { return 'group'; } })();


const MODES = [['group', 'By group'], ['person', 'By person'], ['plan', 'By plan']];
const modeSwitch = (root, conflicts) => h('div', { class: 'seg', role: 'group', 'aria-label': 'Show by' },
  MODES.map(([k, label]) => h('button', { 'aria-pressed': String(mode === k), onclick: () => { mode = k; try { localStorage.setItem('trip.dayMode', k); } catch { /* ignore */ } renderDay(root, conflicts); } }, label)));

export function renderDay(root, conflicts) {
  clear(root);
  const m = state.model;

  const date = state.date;
  const days = tripDays(m, jpNow().date);
  const today = jpNow().date;
  const flagged = new Set(conflicts.filter((c) => c.date && c.severity !== 'info').map((c) => c.date));

  // Date picker: arrows, native date input, and a strip of trip days
  const input = h('input', { type: 'date', value: date, min: m.range?.start, max: m.range?.end, 'aria-label': 'Pick a date', onchange: (e) => e.target.value && setDate(e.target.value) });
  root.append(h('div', { class: 'datebar' },
    h('button', { class: 'icon-btn', 'aria-label': 'Previous day', onclick: () => setDate(addDays(date, -1)) }, icon('chevl')),
    h('div', { class: 'date-label' }, fmtDay(date), date === today ? h('span', { class: 'muted small' }, ' · today') : null, input),
    h('button', { class: 'icon-btn', 'aria-label': 'Next day', onclick: () => setDate(addDays(date, 1)) }, icon('chevr'))));

  const strip = h('div', { class: 'daystrip', role: 'group', 'aria-label': 'Trip days' }, days.map((d) => h('button', {
    'aria-pressed': String(d === date), class: [d === today ? 'today' : '', flagged.has(d) ? 'flag' : ''].join(' '),
    'aria-label': fmtDay(d) + (flagged.has(d) ? ', has issues' : ''), onclick: () => setDate(d),
  }, fmtDay(d).slice(0, 3), h('b', null, String(+d.slice(8))))));
  root.append(strip);
  requestAnimationFrame(() => strip.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' }));

  if (!m.people.length) {
    root.append(h('div', { class: 'empty' }, state.data ? 'No people in the People tab yet.' : 'Loading the trip…'));
    return;
  }
  if (m.range && (date < m.range.start || date > m.range.end)) {
    root.append(h('div', { class: 'banner info' }, `This date is outside the trip (${fmtDay(m.range.start)} – ${fmtDay(m.range.end)}).`));
  }

  // Issues on this day
  const todays = conflicts.filter((c) => c.date === date && c.severity !== 'info');
  if (todays.length) {
    root.append(h('div', { class: 'banner warn' }, icon('issues', 18), h('div', null, todays.map((c) => h('div', null, c.message)))));
  }

  root.append(h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '10px' } }, modeSwitch(root, conflicts)));

  const pass = makePass(m, state.filters, { ignoreDates: true });
  const only = selectedPeople(m, state.filters);
  const flaggedIds = new Set(conflicts.filter((c) => c.date === date).flatMap((c) => c.itemIds));

  if (mode === 'plan') { renderPlan(root, date, { pass, only }); return; } // the day, condensed for the whole group

  if (mode === 'group') {
    const groups = dayGroups(m, date, { pass, onlyPeople: only });
    groups.forEach((g) => root.append(groupCard(g, date, flaggedIds)));
  } else {
    const names = m.people.map((p) => p.name).filter((n) => !only.length || only.includes(n));
    names.forEach((n) => {
      const groups = dayGroups(m, date, { pass, onlyPeople: [n] });
      root.append(groupCard(groups[0], date, flaggedIds, n));
    });
  }

  // Ideas (Ideas tab) for every city someone is in today
  const cities = [];
  dayGroups(m, date, { pass, onlyPeople: only }).forEach((g) => g.cities.forEach((c) => { if (!cities.some((x) => x.toLowerCase() === c.toLowerCase())) cities.push(c); }));
  const ideas = dayIdeas(date, cities);
  if (ideas) root.append(ideas);
}

function groupCard(g, date, flaggedIds, person) {
  const stay = g.stay;
  const head = h('div', { class: 'group-head' },
    h('div', null,
      h('h3', null, person ? personChip(person) : null, person ? ' ' : null, g.label),
      h('div', { class: 'where' }, stay
        ? [`Sleeping at ${stay.title}`, stay.status !== 'Confirmed' ? [' · ', statusBadge(stay.status)] : null]
        : g.transit ? `On ${g.transit.title} overnight` : 'Nowhere to sleep booked for tonight')),
    person ? null : whoChips(g.people));

  const wx = h('div', null, g.cities.map((c) => weatherChip(c, date, stay)));

  const list = h('ul', { class: 'timeline' }, g.timeline.map((e) => timelineRow(e, g, flaggedIds)));
  if (!g.timeline.length) list.append(h('li', null, h('span'), h('span'), h('span', { class: 'muted' }, 'Nothing planned.'), h('span')));
  return h('section', { class: 'card', 'aria-label': `${g.label}: ${g.people.join(', ')}` }, head, wx, list);
}

function timelineRow(e, g, flaggedIds) {
  const it = e.item;
  const time = e.kind === 'checkout' ? 'Out' : e.kind === 'checkin' ? 'In' : e.kind === 'staying' ? 'Night' : itemTimeLabel(it);
  let title = it.title;
  if (e.kind === 'checkout') title = `Check out: ${it.title}`;
  if (e.kind === 'checkin') title = `Check in: ${it.title}`;
  if (e.kind === 'staying') title = `Staying: ${it.title}`;
  // Shown per item: its type, where, who, and a Google Maps link. Notes and booking details are in the item's form.
  const TYPE = { stay: 'Stay', transport: it.mode || 'Transport', reservation: it.kind || 'Reservation', note: 'Note' };
  const where = it.type === 'transport' ? '' : it.type === 'stay' ? (it.address || it.city) : [it.address || '', it.city].filter(Boolean).join(', ');
  const meta = [h('span', { class: 'type-tag' }, TYPE[it.type] || it.type)];
  if (it.status && it.status !== 'Confirmed') meta.push(statusBadge(it.status));
  if (where) meta.push(h('span', null, where));
  if (it.type !== 'note' || it.who) meta.push(whoChips(it.people));
  if (it.raw._pending) meta.push(h('span', { class: 'pending-tag' }, 'Not synced yet'));
  const links = e.kind === 'staying' ? null : googleMapsLink(it);
  return h('li', { class: [it.status === 'Cancelled' ? 'cancelled' : '', flaggedIds.has(it.id) ? 'flagged' : ''].join(' ') },
    h('span', { class: 't' }, time),
    h('span', { class: 'ic' }, icon(e.kind === 'checkout' || e.kind === 'checkin' || e.kind === 'staying' ? e.kind : it.type)),
    h('div', null, h('div', { class: 'ttl' }, title), meta.length ? h('div', { class: 'meta' }, meta) : null,
      links ? h('div', { class: 'meta', style: { marginTop: '6px' } }, links) : null),
    h('button', { class: 'icon-btn', 'aria-label': `Edit ${it.title}`, onclick: () => openEditor(it.tab, it.raw) }, icon('edit', 18)));
}

export { whereabouts };
