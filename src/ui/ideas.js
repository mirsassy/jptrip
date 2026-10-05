// Idea cards (Ideas tab rows: restaurants, activities…) with what helps when booking,
// used on the Ideas tab and at the end of each day.
import { h, icon } from './dom.js';
import { state } from '../lib/store.js';
import { closedOn, ideasFor } from '../lib/ideas.js';
import { safeUrl, statusBadge, googleMapsLink } from './common.js';
import { openEditor, openMoveIdea } from './forms.js';

const KID = { Yes: 'Kid-friendly', Mixed: 'Mixed for kids', No: 'Not aimed at kids', Check: 'Check age rules' };

/** One idea. With `date`, warns when its timing note says it is closed that day. */
export function ideaCard(it, { date = '', compact = false } = {}) {
  const closed = date && closedOn(it.timing, date);
  const required = /required/i.test(it.booking);
  const verify = /verify/i.test(it.verification);
  const kid = KID[it.kidRaw] || (it.kidRaw ? `Kids: ${it.kidRaw}` : '');
  const sub = [it.category, it.area, it.price].filter(Boolean).join(' · ');
  return h('div', { class: `idea${closed ? ' closed' : ''}`, dataset: { idea: it.id } },
    h('div', { class: 'idea-head' },
      h('div', { style: { minWidth: 0 } },
        h('div', { class: 'idea-title' }, it.title),
        sub ? h('div', { class: 'small muted' }, sub) : null),
      it.michelin ? h('span', { class: 'chip michelin', title: 'Michelin' }, it.michelin) : null),
    h('div', { class: 'chips', style: { marginTop: '6px' } },
      kid ? h('span', { class: `chip${it.kidRaw === 'Yes' ? '' : ' muted'}` }, it.kidRaw === 'Yes' ? icon('kid', 13) : null, kid) : null,
      it.bestFor ? h('span', { class: 'chip' }, it.bestFor) : null,
      verify ? h('span', { class: 'chip warn', title: it.verification }, 'Verify details') : null,
      it.status && it.status !== 'Idea' ? statusBadge(it.status) : null,
      it.raw._pending ? h('span', { class: 'pending-tag' }, 'Not synced yet') : null),
    it.booking ? h('div', { class: `small idea-line${required ? ' strong' : ''}` }, h('b', null, 'Booking: '), it.booking) : null,
    closed ? h('div', { class: 'small idea-line warn-text', role: 'note' }, icon('issues', 13), ' May be closed this day: ', it.timing) : it.timing ? h('div', { class: 'small idea-line' }, h('b', null, 'When: '), it.timing) : null,
    !compact && it.raw.Notes ? h('div', { class: 'small idea-line muted' }, it.raw.Notes) : null,
    h('div', { class: 'row', style: { marginTop: '8px' } },
      it.status !== 'Confirmed' && it.status !== 'Cancelled' ? h('button', { class: 'btn small primary', onclick: () => openMoveIdea(it.raw) }, icon('reservation', 15), 'Book') : null,
      googleMapsLink(it),
      safeUrl(it.link) ? h('a', { class: 'btn small', href: safeUrl(it.link), target: '_blank', rel: 'noopener' }, 'Source', icon('ext', 13)) : null,
      h('button', { class: 'icon-btn', 'aria-label': `Edit ${it.title}`, onclick: () => openEditor('Ideas', it.raw) }, icon('edit', 16))));
}

/**
 * "Ideas for this day": open ideas in each city where people are that day,
 * one collapsible section per city, restaurants then activities.
 */
export function dayIdeas(date, cities) {
  const kidOnly = state.filters.kidOnly;
  const sections = cities.map((city) => {
    const list = ideasFor(state.model, [city], { kidOnly, date });
    if (!list.length) return null;
    const byType = new Map();
    list.forEach((it) => { if (!byType.has(it.ideaType)) byType.set(it.ideaType, []); byType.get(it.ideaType).push(it); });
    const order = [...byType.keys()].sort((a, b) => (a === 'Restaurant' ? -1 : b === 'Restaurant' ? 1 : a.localeCompare(b)));
    const counts = order.map((t) => `${byType.get(t).length} ${plural(t, byType.get(t).length)}`).join(', ');
    return h('details', { class: 'card ideas-day' },
      h('summary', null, icon('idea', 18), h('span', null, h('b', null, `Ideas in ${city}`), h('span', { class: 'small muted' }, ` · ${counts}`))),
      order.map((t) => h('div', null,
        h('div', { class: 'section-title' }, plural(t, 2)),
        byType.get(t).map((it) => ideaCard(it, { date, compact: true })))));
  }).filter(Boolean);
  if (!sections.length) return null;
  return h('section', { 'aria-label': 'Ideas for this day' },
    h('div', { class: 'section-title' }, 'Ideas for this day', kidOnly ? ' (kid-friendly only)' : ''), sections);
}

function plural(type, n) {
  const t = type.toLowerCase();
  if (n === 1) return t;
  if (t === 'activity') return 'activities';
  return /s$/.test(t) ? t : `${t}s`;
}
