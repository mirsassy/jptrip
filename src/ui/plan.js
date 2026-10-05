// "By plan": the whole trip grouped by kind of plan (travel, stays, each type of
// reservation, notes), each in date order. Uses the same filters as the other views.
import { h, icon } from './dom.js';
import { state, setDate } from '../lib/store.js';
import { makePass } from '../lib/filters.js';
import { byTime } from '../lib/model.js';
import { fmtShort } from '../lib/dates.js';
import { whoChips, statusBadge, googleMapsLink, itemTimeLabel } from './common.js';
import { openEditor } from './forms.js';

const plural = (t) => (/y$/i.test(t) ? `${t.slice(0, -1)}ies` : /s$/i.test(t) ? t : `${t}s`);

export function renderPlan(root) {
  const m = state.model;
  const pass = makePass(m, state.filters);
  const items = m.items.filter((it) => it.type !== 'idea' && pass(it));

  const sections = [];
  const add = (key, title, ic, list) => { if (list.length) sections.push({ key, title, ic, list: list.sort(byTime) }); };
  add('travel', 'Travel', 'transport', items.filter((it) => it.type === 'transport'));
  add('stays', 'Stays', 'stay', items.filter((it) => it.type === 'stay'));
  const res = items.filter((it) => it.type === 'reservation');
  const kinds = [...new Set(res.map((it) => it.kind || 'Other'))].sort((a, b) => (a === 'Restaurant' ? -1 : b === 'Restaurant' ? 1 : a.localeCompare(b)));
  kinds.forEach((k) => add(`res-${k}`, plural(k), k === 'Restaurant' ? 'idea' : 'reservation', res.filter((it) => (it.kind || 'Other') === k)));
  add('notes', 'Notes', 'note', items.filter((it) => it.type === 'note'));

  if (!sections.length) { root.append(h('div', { class: 'empty' }, 'Nothing planned yet, or nothing matches the filters.')); return; }

  // Quick jump between sections, with counts
  root.append(h('div', { class: 'chips', style: { marginBottom: '10px' } }, sections.map((s) => h('a', { class: 'chip', href: `#day`, onclick: (e) => { e.preventDefault(); document.getElementById(`plan-${s.key}`)?.scrollIntoView({ behavior: 'smooth' }); } }, `${s.title} (${s.list.length})`))));

  sections.forEach((s) => {
    root.append(h('section', { class: 'card', id: `plan-${s.key}`, 'aria-label': s.title },
      h('h3', { style: { marginTop: 0 } }, icon(s.ic, 18), ' ', s.title),
      h('ul', { class: 'plan-list' }, s.list.map((it) => planRow(it)))));
  });
}

function planRow(it) {
  const when = it.type === 'stay' ? `${fmtShort(it.date)} – ${fmtShort(it.endDate)}` : [fmtShort(it.date), itemTimeLabel(it)].filter(Boolean).join(' ');
  const where = it.type === 'transport' ? it.carrier : it.city && !it.title.includes(it.city) ? it.city : '';
  const maps = googleMapsLink(it);
  return h('li', { class: it.status === 'Cancelled' ? 'cancelled' : '' },
    h('button', { class: 'link plan-when', 'aria-label': `Open ${fmtShort(it.date)}`, onclick: () => { if (it.date) { setDate(it.date); location.hash = '#day'; window.scrollTo(0, 0); document.dispatchEvent(new CustomEvent('plan-open-day')); } } }, when || 'No date'),
    h('div', { style: { minWidth: 0 } },
      h('div', { class: 'ttl' }, it.title, it.status && it.status !== 'Confirmed' ? [' ', statusBadge(it.status)] : null),
      h('div', { class: 'meta' }, where ? h('span', null, where) : null, it.type !== 'note' || it.who ? whoChips(it.people) : null),
    ),
    h('div', { class: 'row', style: { gap: '0', flexWrap: 'nowrap' } },
      maps ? h('a', { class: 'icon-btn', href: maps.href, target: '_blank', rel: 'noopener', 'aria-label': `${it.title} in Google Maps` }, icon('pin', 18)) : null,
      h('button', { class: 'icon-btn', 'aria-label': `Edit ${it.title}`, onclick: () => openEditor(it.tab, it.raw) }, icon('edit', 16))));
}
