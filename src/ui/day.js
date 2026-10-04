import { h, icon, clear } from './dom.js';
import { state, setDate } from '../lib/store.js';
import { dayGroups, tripDays, whereabouts } from '../lib/model.js';
import { makePass, selectedPeople } from '../lib/filters.js';
import { addDays, fmtDay, jpNow } from '../lib/dates.js';
import { whoChips, statusBadge, weatherChip, mapLinks, itemTimeLabel, personChip } from './common.js';
import { openEditor } from './forms.js';
import { openAttachment } from './import.js';

let mode = (() => { try { return localStorage.getItem('trip.dayMode') || 'group'; } catch { return 'group'; } })();

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

  root.append(h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '10px' } },
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Show by' },
      ['group', 'person'].map((k) => h('button', { 'aria-pressed': String(mode === k), onclick: () => { mode = k; try { localStorage.setItem('trip.dayMode', k); } catch { /* ignore */ } renderDay(root, conflicts); } }, k === 'group' ? 'By group' : 'By person')))));

  const pass = makePass(m, state.filters, { ignoreDates: true });
  const only = selectedPeople(m, state.filters);
  const flaggedIds = new Set(conflicts.filter((c) => c.date === date).flatMap((c) => c.itemIds));

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
  const others = it.people.filter((p) => !g.people.includes(p));
  const partial = g.people.filter((p) => it.people.includes(p));
  const meta = [];
  if (it.status && it.status !== 'Confirmed') meta.push(statusBadge(it.status));
  if (it.type === 'transport' && it.carrier) meta.push(h('span', null, it.carrier));
  if (it.type === 'reservation' && it.kind) meta.push(h('span', null, it.kind));
  if (it.type === 'reservation' || it.type === 'transport') meta.push(h('span', null, state.model.partySummary(it.people) + (it.partySize ? ` · booked for ${it.partySize}` : '')));
  if (it.city && it.type !== 'stay') meta.push(h('span', null, it.city));
  if (it.raw['Confirmation #']) meta.push(h('span', null, `Conf. ${it.raw['Confirmation #']}`));
  if (it.raw.Seats) meta.push(h('span', null, `Seats ${it.raw.Seats}`));
  if (it.raw.Attachment && e.kind !== 'staying') meta.push(h('button', { class: 'link', onclick: () => openAttachment(it.raw.Attachment) }, icon('clip', 14), ' File'));
  if (partial.length < g.people.length) meta.push(h('span', null, 'Only: ', whoChips(partial)));
  if (others.length) meta.push(h('span', null, `With ${others.join(', ')}`));
  if (it.raw._pending) meta.push(h('span', { class: 'pending-tag' }, 'Not synced yet'));
  const notes = it.raw.Notes && it.type !== 'note' ? h('div', { class: 'meta' }, it.raw.Notes) : null;
  const links = it.type === 'transport' ? null : mapLinks(it);
  return h('li', { class: [it.status === 'Cancelled' ? 'cancelled' : '', flaggedIds.has(it.id) ? 'flagged' : ''].join(' ') },
    h('span', { class: 't' }, time),
    h('span', { class: 'ic' }, icon(e.kind === 'checkout' || e.kind === 'checkin' || e.kind === 'staying' ? e.kind : it.type)),
    h('div', null, h('div', { class: 'ttl' }, title), meta.length ? h('div', { class: 'meta' }, meta) : null, notes,
      e.kind !== 'staying' && links ? h('div', { class: 'meta', style: { marginTop: '6px' } }, links) : null),
    h('button', { class: 'icon-btn', 'aria-label': `Edit ${it.title}`, onclick: () => openEditor(it.tab, it.raw) }, icon('edit', 18)));
}

export { whereabouts };
