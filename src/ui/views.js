// List, Restaurant ideas, Issues, Filters and Settings views.
import { h, icon, clear, sheet, toast } from './dom.js';
import { state, setFilters, setDate, dismissFailed } from '../lib/store.js';
import { renderSignIn, settingsCards } from './account.js';
import { makePass, DEFAULT_FILTERS, activeFilterCount } from '../lib/filters.js';
import { TYPES, TYPE_LABELS, STATUSES, byTime } from '../lib/model.js';
import { fmtDay } from '../lib/dates.js';
import { whoChips, statusBadge, mapLinks, itemTimeLabel, TYPE_ICON, safeUrl } from './common.js';
import { openEditor, openMoveIdea } from './forms.js';

/* ---------------- List: everything that passes the filters, by date ---------------- */
export function renderList(root) {
  clear(root);
  const m = state.model;
  const pass = makePass(m, state.filters);
  const items = m.items.filter((it) => it.type !== 'idea' && pass(it));
  root.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } },
    h('h2', { style: { margin: '4px 0 8px', fontSize: '1.15rem' } }, 'All plans'),
    h('span', { class: 'muted small' }, `${items.length} shown`)));
  if (activeFilterCount(state.filters)) root.append(filterSummary());
  const undated = items.filter((it) => !it.date);
  const byDate = new Map();
  items.filter((it) => it.date).sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b)).forEach((it) => {
    if (!byDate.has(it.date)) byDate.set(it.date, []);
    byDate.get(it.date).push(it);
  });
  if (!items.length) root.append(h('div', { class: 'empty' }, 'Nothing matches the filters.'));
  byDate.forEach((list, date) => {
    root.append(h('div', { class: 'section-title' }, h('button', { class: 'link', onclick: () => { setDate(date); location.hash = '#day'; } }, fmtDay(date))));
    root.append(h('div', { class: 'card', style: { padding: '4px 14px' } }, list.map(itemRow)));
  });
  if (undated.length) {
    root.append(h('div', { class: 'section-title' }, 'No date'));
    root.append(h('div', { class: 'card', style: { padding: '4px 14px' } }, undated.map(itemRow)));
  }
}

function itemRow(it) {
  const when = it.type === 'stay' ? `${fmtDay(it.date)} → ${fmtDay(it.endDate)}` : itemTimeLabel(it);
  return h('div', { class: 'item-row', role: 'button', tabindex: 0, onclick: () => openEditor(it.tab, it.raw), onkeydown: (e) => { if (e.key === 'Enter') openEditor(it.tab, it.raw); } },
    h('span', { class: 'muted' }, icon(TYPE_ICON[it.type])),
    h('div', null,
      h('div', { style: { fontWeight: 550 } }, it.title),
      h('div', { class: 'small muted row', style: { gap: '4px 10px' } }, when ? h('span', null, when) : null, it.city && it.type !== 'transport' ? h('span', null, it.city) : null, it.raw._pending ? h('span', { class: 'pending-tag' }, 'Not synced yet') : null),
      it.type === 'idea' ? null : h('div', { style: { marginTop: '4px' } }, whoChips(it.people, { max: 5 }))),
    statusBadge(it.status));
}

function filterSummary() {
  return h('div', { class: 'banner info' }, icon('filter', 18), h('div', null, `${activeFilterCount(state.filters)} filter(s) on. `,
    h('button', { class: 'link', onclick: () => setFilters({ ...DEFAULT_FILTERS }) }, 'Clear filters')));
}

/* ---------------- Restaurant ideas ---------------- */
export function renderIdeas(root) {
  clear(root);
  const m = state.model;
  const f = state.filters;
  const pass = makePass(m, { ...f, types: [] });
  const ideas = m.items.filter((it) => it.type === 'idea' && pass(it)).sort((a, b) => a.city.localeCompare(b.city) || a.title.localeCompare(b.title));
  const citySel = h('select', { 'aria-label': 'City', onchange: (e) => setFilters({ cities: e.target.value ? [e.target.value] : [] }) },
    h('option', { value: '' }, 'All cities'), m.cities.map((c) => h('option', { value: c.name }, c.name)));
  citySel.value = f.cities.length === 1 ? f.cities[0] : '';
  root.append(h('h2', { style: { margin: '4px 0 8px', fontSize: '1.15rem' } }, 'Restaurant ideas'),
    h('div', { class: 'row', style: { marginBottom: '12px' } },
      h('div', { class: 'field', style: { margin: 0, minWidth: '150px' } }, citySel),
      h('div', { class: 'toggle-chips' }, h('button', { 'aria-pressed': String(f.kidOnly), onclick: () => setFilters({ kidOnly: !f.kidOnly }) }, icon('kid', 16), 'Kid-friendly only')),
      h('button', { class: 'btn small', onclick: () => openEditor('Restaurant ideas', null, { City: f.cities.length === 1 ? f.cities[0] : '' }) }, icon('plus', 16), 'Add idea')));
  if (!ideas.length) {
    root.append(h('div', { class: 'empty' }, m.items.some((i) => i.type === 'idea') ? 'No ideas match the filters.' : 'No restaurant ideas yet. Tap “Add idea” to suggest one.'));
    return;
  }
  ideas.forEach((it) => {
    root.append(h('div', { class: 'card' },
      h('div', { class: 'group-head' },
        h('div', null, h('h3', null, it.title), h('div', { class: 'where' }, [it.city, it.cuisine, it.price].filter(Boolean).join(' · '))),
        statusBadge(it.status)),
      h('div', { class: 'row small', style: { marginTop: '8px' } },
        it.kid === 'Yes' ? h('span', { class: 'chip' }, icon('kid', 14), 'Kid-friendly') : it.kid === 'No' ? h('span', { class: 'chip' }, 'Not for kids') : null,
        it.raw['Reservation needed'] ? h('span', { class: 'chip' }, `Reservation needed: ${it.raw['Reservation needed']}`) : null,
        it.raw['Booking method'] ? h('span', { class: 'chip' }, it.raw['Booking method']) : null,
        it.raw['Suggested by'] ? h('span', { class: 'muted' }, `Suggested by ${it.raw['Suggested by']}`) : null,
        it.raw._pending ? h('span', { class: 'pending-tag' }, 'Not synced yet') : null),
      it.raw.Notes ? h('p', { class: 'small', style: { margin: '8px 0 0' } }, it.raw.Notes) : null,
      h('div', { class: 'row', style: { marginTop: '10px' } },
        it.status !== 'Confirmed' && it.status !== 'Cancelled' ? h('button', { class: 'btn small primary', onclick: () => openMoveIdea(it.raw) }, icon('reservation', 16), 'Move to Reservations') : null,
        h('button', { class: 'btn small', onclick: () => openEditor('Restaurant ideas', it.raw) }, icon('edit', 16), 'Edit'),
        safeUrl(it.link) ? h('a', { class: 'btn small', href: safeUrl(it.link), target: '_blank', rel: 'noopener' }, 'Website', icon('ext', 14)) : null,
        mapLinks(it))));
  });
}

/* ---------------- Issues ---------------- */
export function renderIssues(root, conflicts) {
  clear(root);
  root.append(h('h2', { style: { margin: '4px 0 8px', fontSize: '1.15rem' } }, 'Things to check'));
  if (state.failedOps.length) {
    root.append(h('div', { class: 'banner error' }, h('div', null,
      h('div', null, `${state.failedOps.length} change(s) could not be saved to the Sheet:`),
      state.failedOps.map((o) => h('div', { class: 'small' }, `${o.payload?.tab || o.action}: ${o.error}`)),
      h('button', { class: 'link', onclick: dismissFailed }, 'Dismiss'))));
  }
  if (!conflicts.length) {
    root.append(h('div', { class: 'empty' }, 'No problems found.'));
    return;
  }
  const groups = [['error', 'Fix first'], ['warn', 'Warnings'], ['info', 'Worth checking']];
  groups.forEach(([sev, label]) => {
    const list = conflicts.filter((c) => c.severity === sev);
    if (!list.length) return;
    root.append(h('div', { class: 'section-title' }, `${label} (${list.length})`));
    root.append(h('div', { class: 'card', style: { padding: '4px 14px' } }, list.map((c) => h('div', { class: `issue ${c.severity}` },
      icon('issues', 18),
      h('div', null, h('div', { style: { fontWeight: 600 } }, c.title), h('div', { class: 'small' }, c.message),
        h('div', { class: 'row', style: { marginTop: '6px' } },
          c.date ? h('button', { class: 'btn small', onclick: () => { setDate(c.date); location.hash = '#day'; } }, `Go to ${fmtDay(c.date)}`) : null,
          c.itemIds.map((id) => state.model.itemById.get(id)).filter(Boolean).slice(0, 2).map((it) => h('button', { class: 'btn small', onclick: () => openEditor(it.tab, it.raw) }, icon('edit', 14), it.title.slice(0, 24)))))))));
  });
}

/* ---------------- Filters panel ---------------- */
export function openFilters() {
  const m = state.model;
  const f = { ...state.filters };
  const toggles = (label, options, key, render = (o) => o) => {
    const box = h('div', { class: 'toggle-chips' });
    const draw = () => box.replaceChildren(...options.map((o) => h('button', { type: 'button', 'aria-pressed': String(f[key].includes(o)), onclick: () => {
      f[key] = f[key].includes(o) ? f[key].filter((x) => x !== o) : [...f[key], o];
      draw();
    } }, render(o))));
    draw();
    return h('div', { class: 'field', role: 'group', 'aria-label': label }, h('span', null, label), box);
  };
  const personLabel = (n) => [h('span', { class: 'sw', style: { background: m.peopleByName.get(n)?.color } }), n];
  const from = h('input', { type: 'date', value: f.from, min: m.range?.start, max: m.range?.end, 'aria-label': 'From date' });
  const to = h('input', { type: 'date', value: f.to, min: m.range?.start, max: m.range?.end, 'aria-label': 'To date' });
  const kid = h('input', { type: 'checkbox', checked: f.kidOnly });
  const body = h('div', null,
    h('p', { class: 'muted small', style: { marginTop: 0 } }, 'Filters apply to every view and are remembered on this device. Nothing selected means “all”.'),
    toggles('People', m.people.map((p) => p.name), 'people', personLabel),
    toggles('Groups', m.groups.map((g) => g.name), 'groups'),
    toggles('Cities', m.cities.map((c) => c.name), 'cities'),
    toggles('Type', TYPES, 'types', (t) => TYPE_LABELS[t]),
    toggles('Status', STATUSES, 'statuses'),
    h('div', { class: 'field', role: 'group', 'aria-label': 'Dates' }, h('span', null, 'Dates ', h('span', { class: 'hint' }, '(List and Map “all dates”)')), h('div', { class: 'two' }, from, to)),
    h('label', { class: 'row', style: { marginBottom: '14px' } }, kid, 'Restaurant ideas: kid-friendly only'),
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn', style: { marginRight: 'auto' }, onclick: () => { setFilters({ ...DEFAULT_FILTERS }); s.close(); } }, 'Reset'),
      h('button', { class: 'btn primary', onclick: () => {
        if (!f.statuses.length) f.statuses = [...DEFAULT_FILTERS.statuses];
        setFilters({ ...f, from: from.value, to: to.value, kidOnly: kid.checked });
        s.close();
      } }, 'Apply')));
  const s = sheet('Filters', body);
}

/* ---------------- Settings / sign-in ---------------- */
export function renderSettings(root, { firstRun = false, inDialog = false } = {}) {
  if (firstRun) { renderSignIn(root); return; }
  clear(root);
  root.append(
    inDialog ? null : h('h2', { style: { margin: '4px 0 8px', fontSize: '1.15rem' } }, 'Settings'),
    ...settingsCards().filter(Boolean),
    h('div', { class: 'card' },
      h('h3', { style: { marginTop: 0 } }, 'Offline maps'),
      h('p', { class: 'small' }, 'Map areas you have looked at are kept for offline use. To have a city available offline, open it on the map while online and zoom around the parts you need.'),
      h('button', { class: 'btn small', onclick: async () => { await caches.delete('map-tiles'); toast('Saved map tiles cleared.'); } }, 'Clear saved map tiles')),
    h('p', { class: 'small muted' }, 'All times are Japan time (JST). Weather: Open-Meteo. Map: OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors.'));
}
