// A read-only view of one plan (stay, travel, reservation, note), with buttons to
// open it on the map, open its day, or edit it.
import { h, icon, sheet } from './dom.js';
import { state, setDate } from '../lib/store.js';
import { fmtDay, fmtShort } from '../lib/dates.js';
import { whoChips, statusBadge, googleMapsLink, itemTimeLabel, safeUrl } from './common.js';
import { openEditor } from './forms.js';

const LABEL = { stay: 'Stay', transport: 'Travel', reservation: 'Reservation', note: 'Note', idea: 'Idea' };

export function openItemView(it) {
  const r = it.raw;
  const when = it.type === 'stay'
    ? `${fmtDay(it.date)} → ${fmtDay(it.endDate)}`
    : [it.date ? fmtDay(it.date) : '', itemTimeLabel(it)].filter(Boolean).join(' · ');
  const where = it.type === 'transport' ? `${it.from || '?'} → ${it.to || '?'}` : [it.address, it.city].filter(Boolean).join(', ');
  const rows = [
    ['When', when],
    ['Where', where],
    it.type === 'transport' ? ['Carrier / train', it.carrier] : null,
    it.type === 'reservation' ? ['Type', it.kind] : null,
    ['Confirmation #', r['Confirmation #']],
    ['Seats', r.Seats],
    it.type === 'reservation' ? ['Party size', r['Party size'] ? `${r['Party size']}${it.people.length ? ` (${state.model.partySummary(it.people)})` : ''}` : ''] : null,
    ['Cancellation deadline', r['Cancellation deadline'] ? `${r['Cancellation deadline']} JST` : ''],
    ['Notes', it.type === 'note' ? '' : r.Notes],
  ].filter((x) => x && x[1]);
  const link = safeUrl(r.Link);
  const body = h('div', null,
    h('div', { class: 'row', style: { marginBottom: '8px' } }, h('span', { class: 'type-tag' }, it.type === 'transport' && it.mode ? it.mode : LABEL[it.type]), statusBadge(it.status)),
    it.type === 'note' ? h('p', null, it.title) : null,
    h('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
    it.type !== 'idea' ? h('div', { style: { margin: '10px 0' } }, whoChips(it.people)) : null,
    h('div', { class: 'row', style: { marginTop: '12px' } },
      googleMapsLink(it),
      link ? h('a', { class: 'btn small', href: link, target: '_blank', rel: 'noopener' }, 'Website', icon('ext', 13)) : null,
      it.date ? h('button', { class: 'btn small', onclick: () => { s.close(); setDate(it.date); location.hash = '#day'; } }, icon('day', 15), `Open ${fmtShort(it.date)}`) : null,
      h('button', { class: 'btn small primary', onclick: () => { s.close(); openEditor(it.tab, r); } }, icon('edit', 15), 'Edit')));
  const s = sheet(it.type === 'note' ? 'Note' : it.title, body);
  return s;
}
