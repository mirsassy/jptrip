// Idea cards (Ideas tab rows: restaurants, activities…) with what helps when booking,
// used on the Ideas tab and at the end of each day.
import { h, icon } from './dom.js';
import { state } from '../lib/store.js';
import { closedOn, ideasFor } from '../lib/ideas.js';
import { safeUrl, statusBadge, googleMapsLink } from './common.js';
import { openEditor, openMoveIdea } from './forms.js';

const KID = { Yes: 'Kid-friendly', Mixed: 'Mixed for kids', No: 'Not aimed at kids', Check: 'Check age rules' };

/** One idea. With `date`, warns when its timing note says it is closed that day. */
export function ideaCard(it, { date = '' } = {}) {
  const closed = date && closedOn(it.timing, date);
  const required = /required/i.test(it.booking);
  const verify = /verify/i.test(it.verification);
  const kid = KID[it.kidRaw] || (it.kidRaw ? `Kids: ${it.kidRaw}` : '');
  const sub = [it.category, it.area, it.price].filter(Boolean).join(' · ');
  return h('div', { class: `idea${closed ? ' closed' : ''}`, dataset: { idea: it.id } },
    h('div', { class: 'idea-head' },
      h('div', { style: { minWidth: 0 } },
        h('div', { class: 'idea-title' }, h('span', { class: `type-dot type-${it.ideaType.toLowerCase()}`, title: it.ideaType }, icon(typeIcon(it.ideaType), 13)), ' ', it.title),
        sub ? h('div', { class: 'small muted' }, sub) : null),
      it.michelin ? h('span', { class: 'chip michelin', title: 'Michelin' }, it.michelin) : null),
    h('div', { class: 'chips', style: { marginTop: '6px' } },
      it.mustTry ? h('span', { class: 'chip must' }, '★ Must-try') : null,
      kid ? h('span', { class: `chip${it.kidRaw === 'Yes' ? '' : ' muted'}` }, it.kidRaw === 'Yes' ? icon('kid', 13) : null, kid) : null,
      it.bestFor ? h('span', { class: 'chip' }, it.bestFor) : null,
      verify ? h('span', { class: 'chip warn', title: it.verification }, 'Verify details') : null,
      it.status && it.status !== 'Idea' ? statusBadge(it.status) : null,
      it.raw._pending ? h('span', { class: 'pending-tag' }, 'Not synced yet') : null),
    it.booking ? h('div', { class: `small idea-line${required ? ' strong' : ''}` }, h('b', null, 'Booking: '), it.booking) : null,
    closed ? h('div', { class: 'small idea-line warn-text', role: 'note' }, icon('issues', 13), ' May be closed this day: ', it.timing) : it.timing ? h('div', { class: 'small idea-line' }, h('b', null, 'When: '), it.timing) : null,
    it.raw.Notes ? h('div', { class: 'small idea-line idea-why' }, h('b', null, 'Why: '), it.raw.Notes) : null,
    h('div', { class: 'row', style: { marginTop: '8px' } },
      it.status !== 'Confirmed' && it.status !== 'Cancelled' ? h('button', { class: 'btn small primary', onclick: () => openMoveIdea(it.raw) }, icon('reservation', 15), 'Book') : null,
      googleMapsLink(it),
      safeUrl(it.link) ? h('a', { class: 'btn small', href: safeUrl(it.link), target: '_blank', rel: 'noopener' }, 'Source', icon('ext', 13)) : null,
      h('button', { class: 'icon-btn', 'aria-label': `Edit ${it.title}`, onclick: () => openEditor('Ideas', it.raw) }, icon('edit', 16))));
}

const typeOrder = (a, b) => (a === 'Restaurant' ? -1 : b === 'Restaurant' ? 1 : a === 'Activity' ? -1 : b === 'Activity' ? 1 : a.localeCompare(b));

/** Restaurants first, then activities, then anything else; each with its count. */
export function byIdeaType(list) {
  const byType = new Map();
  list.forEach((it) => { if (!byType.has(it.ideaType)) byType.set(it.ideaType, []); byType.get(it.ideaType).push(it); });
  return [...byType.keys()].sort(typeOrder).map((t) => ({ type: t, items: byType.get(t) }));
}

export const typeIcon = (t) => (t === 'Restaurant' ? 'idea' : t === 'Activity' ? 'activity' : 'pin');

/**
 * "Ideas for this day": open ideas in the cities people are in that day, split into
 * restaurants, then activities (one collapsible card each), by city inside.
 */
const openTypes = new Set();
export function dayIdeas(date, cities) {
  const kidOnly = state.filters.kidOnly;
  const list = ideasFor(state.model, cities, { kidOnly, date });
  if (!list.length) return null;
  const cityOrder = (c) => cities.findIndex((x) => x.toLowerCase() === c.toLowerCase());
  const cards = byIdeaType(list).map(({ type, items }) => {
    const byCity = new Map();
    items.sort((a, b) => cityOrder(a.city) - cityOrder(b.city) || b.mustTry - a.mustTry).forEach((it) => { if (!byCity.has(it.city)) byCity.set(it.city, []); byCity.get(it.city).push(it); });
    const where = [...byCity.keys()].join(', ');
    // Stays open until the person closes it, even when the day is redrawn (sync, weather)
    const d = h('details', { class: `card ideas-day type-${type.toLowerCase()}`, open: openTypes.has(type),
      ontoggle: (e) => { if (e.target.open) openTypes.add(type); else openTypes.delete(type); } },
      h('summary', null, h('span', { class: `type-dot type-${type.toLowerCase()}` }, icon(typeIcon(type), 16)),
        h('span', null, h('b', null, cap(plural(type, 2))), h('span', { class: 'small muted' }, ` · ${items.length} in ${where}`))),
      [...byCity.entries()].map(([city, its]) => h('div', null,
        byCity.size > 1 ? h('div', { class: 'section-title' }, city) : null,
        its.map((it) => ideaCard(it, { date })))));
    return d;
  });
  return h('section', { 'aria-label': 'Ideas for this day' },
    h('div', { class: 'section-title' }, 'Ideas for this day', kidOnly ? ' (kid-friendly only)' : ''), cards);
}

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

function plural(type, n) {
  const t = type.toLowerCase();
  if (n === 1) return t;
  if (t === 'activity') return 'activities';
  return /s$/.test(t) ? t : `${t}s`;
}
