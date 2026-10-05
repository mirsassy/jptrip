// Add/edit forms for every tab. Dropdowns come from the Lists, People and
// Groups tabs. Only fields that changed are sent, so two people editing
// different fields of the same row don't overwrite each other.
import { h, icon, sheet, toast } from './dom.js';
import { state, enqueue, resolveLocation } from '../lib/store.js';
import { parseLocation } from '../lib/api.js';
import { parseDate, parseTime, jpNow } from '../lib/dates.js';
import { STATUSES } from '../lib/model.js';
import { openImport, openAttachment } from './import.js';

const PREFIX = { Stays: 'S', Transport: 'T', Reservations: 'R', 'Restaurant ideas': 'I', Notes: 'N' };
const KEY = { People: 'Name', Groups: 'Group' };

const listCol = (name, fallback = []) => (state.model.lists[name]?.length ? state.model.lists[name].map(String) : fallback);
const statusOpts = () => listCol('Status', STATUSES);
const yesNoOpts = () => listCol('Yes/No', ['Yes', 'No', 'Unsure']);

/** Field specs per tab. `col` is the Sheet header. */
function fieldsFor(tab) {
  const F = (col, type, extra = {}) => ({ col, type, ...extra });
  switch (tab) {
    case 'Stays': return [
      F('Check-in', 'date', { req: true, half: true }), F('Check-out', 'date', { req: true, half: true }),
      F('City', 'city', { req: true }), F('Hotel', 'text'), F('Address', 'text', { hint: 'helps the map pin' }),
      F('Who', 'who', { req: true, reqMsg: 'Pick who is going' }), F('Status', 'select', { opts: statusOpts, def: 'Tentative' }), F('Confirmation #', 'text'),
      F('Notes', 'textarea'), F('Lat', 'location', { lng: 'Lng' }), F('Attachment', 'attachment'),
    ];
    case 'Transport': return [
      F('Date', 'date', { req: true }), F('Depart', 'time', { half: true }), F('Arrive', 'time', { half: true }),
      F('Mode', 'select', { opts: () => listCol('Mode') }), F('From', 'place'), F('To', 'place'),
      F('Carrier / train', 'text'), F('Who', 'who', { req: true, reqMsg: 'Pick who is going' }), F('Seats', 'text'), F('Confirmation #', 'text'),
      F('Status', 'select', { opts: statusOpts, def: 'Tentative' }), F('Notes', 'textarea'),
      F('From Lat', 'location', { lng: 'From Lng', label: 'From: map location' }), F('To Lat', 'location', { lng: 'To Lng', label: 'To: map location' }),
      F('Attachment', 'attachment'),
    ];
    case 'Reservations': return [
      F('Date', 'date', { req: true, half: true }), F('Time', 'time', { half: true }),
      F('Type', 'select', { opts: () => listCol('Reservation type') }), F('Name', 'text', { req: true }),
      F('City', 'city'), F('Address', 'text', { hint: 'helps the map pin' }), F('Who', 'who', { req: true, reqMsg: 'Pick who is going' }),
      F('Party size', 'number', { half: true, hint: 'blank = everyone in Who' }), F('Kid-friendly', 'select', { opts: yesNoOpts, half: true }),
      F('Cancellation deadline', 'datetime', { hint: 'when a fee starts; Japan time' }), F('Confirmation #', 'text'),
      F('Status', 'select', { opts: statusOpts, def: 'Tentative' }), F('Link', 'url'), F('Notes', 'textarea'),
      F('Lat', 'location', { lng: 'Lng' }), F('Attachment', 'attachment'),
    ];
    case 'Restaurant ideas': return [
      F('Name', 'text', { req: true }), F('City', 'city'), F('Cuisine', 'text', { half: true }), F('Price range', 'text', { half: true, hint: 'e.g. ¥¥' }),
      F('Kid-friendly', 'select', { opts: yesNoOpts, half: true }), F('Reservation needed', 'select', { opts: yesNoOpts, half: true }),
      F('Booking method', 'text'), F('Link', 'url'), F('Address', 'text'),
      F('Suggested by', 'select', { opts: () => state.model.people.map((p) => p.name) }),
      F('Status', 'select', { opts: statusOpts, def: 'Idea' }), F('Notes', 'textarea'), F('Lat', 'location', { lng: 'Lng' }),
    ];
    case 'Notes': return [F('Date', 'date', { half: true }), F('City', 'city', { half: true }), F('Who', 'who'), F('Note', 'textarea', { req: true })];
    case 'People': return [
      F('Name', 'text', { req: true }), F('Adult or child', 'select', { opts: () => ['Adult', 'Child'] }),
      F('Group', 'group', { hint: 'e.g. their family' }), F('Color (hex)', 'color'),
      F('Notes', 'textarea', { hint: 'for a child, e.g. "Age 7"' }),
    ];
    default: return [];
  }
}

export const TAB_TITLES = { Stays: 'stay', Transport: 'transport', Reservations: 'reservation', 'Restaurant ideas': 'restaurant idea', Notes: 'note', People: 'person', Groups: 'group' };

/**
 * Opens the add/edit form for a tab. `row` is the raw Sheet row (or null to add). `preset` pre-fills a new row.
 * `onSaved` runs after the change is queued (the import list uses it to tick off a booking).
 */
export function openEditor(tab, row = null, preset = {}, { onSaved, intro } = {}) {
  const isNew = !row;
  const orig = row ? { ...row } : {};
  const values = row ? { ...row } : { ...preset };
  const fields = fieldsFor(tab);
  fields.forEach((f) => { if (isNew && f.def && values[f.col] === undefined) values[f.col] = f.def; });
  if (isNew && tab !== 'People' && tab !== 'Groups' && fields.some((f) => f.col === 'Date') && !values.Date) values.Date = state.date || jpNow().date;
  if (isNew && tab === 'Stays' && !values['Check-in']) values['Check-in'] = state.date || '';

  const form = h('form', { novalidate: true }, intro || null);
  const pendingCities = new Set();
  const errors = new Map();

  const setErr = (col, msg) => {
    const el = form.querySelector(`[data-col="${CSS.escape(col)}"]`);
    if (!el) return;
    el.classList.toggle('invalid', !!msg);
    el.querySelector('.err')?.remove();
    if (msg) el.append(h('div', { class: 'err' }, msg));
    if (msg) errors.set(col, msg); else errors.delete(col);
  };

  let row2 = null;
  fields.forEach((f) => {
    if (f.type === 'attachment' && !values[f.col]) return; // only rows added from an uploaded file have one
    const el = fieldEl(f, values, pendingCities, tab);
    if (f.half) {
      if (!row2) { row2 = h('div', { class: 'two' }); form.append(row2); }
      row2.append(el);
      if (row2.children.length === 2) row2 = null;
    } else {
      row2 = null;
      form.append(el);
    }
  });

  if (tab === 'Restaurant ideas' && !isNew) {
    form.append(h('p', null, h('button', { type: 'button', class: 'btn', onclick: () => { s.close(); openMoveIdea(row); } }, icon('reservation', 18), 'Move to Reservations')));
  }
  if (!isNew && row.ID) form.append(h('p', { class: 'muted small' }, `ID ${row.ID}${row['Last edited by'] ? ` · last edited by ${row['Last edited by']}` : ''}`));

  const save = h('button', { type: 'submit', class: 'btn primary' }, isNew ? 'Add' : 'Save');
  const actions = h('div', { class: 'form-actions' });
  if (!isNew && 'Status' in orig && orig.Status !== 'Cancelled' && tab !== 'People' && tab !== 'Groups') {
    actions.append(h('button', { type: 'button', class: 'btn', style: { marginRight: 'auto' }, onclick: () => {
      if (!confirm('Mark this as Cancelled? It stays in the Sheet and can be shown with the Status filter.')) return;
      submit({ Status: 'Cancelled' });
    } }, 'Cancel booking'));
  }
  actions.append(h('button', { type: 'button', class: 'btn', onclick: () => s.close() }, 'Close'), save);
  form.append(actions);

  async function submit(override) {
    const v = override ? { ...orig, ...override } : collect(form, fields, values);
    if (!override) {
      fields.forEach((f) => setErr(f.col, f.req && !String(v[f.col] ?? '').trim() ? (f.reqMsg || 'Required') : null));
      if (tab === 'Stays' && v['Check-in'] && v['Check-out'] && v['Check-out'] <= v['Check-in']) setErr('Check-out', 'Must be after check-in');
      if (tab === 'People' && isNew && state.model.peopleByName.has(String(v.Name).trim())) setErr('Name', 'Already in the People tab');
      if (errors.size) { form.querySelector('.invalid input, .invalid select, .invalid textarea')?.focus(); return; }
    }
    if (tab === 'Reservations' && String(v['Party size'] ?? '').trim() === '' && String(v.Who ?? '').trim()) {
      v['Party size'] = String(state.model.resolveWho(v.Who).people.length); // the party is everyone in Who
    }
    const changed = {};
    Object.keys(v).forEach((k) => {
      if (k.startsWith('_')) return;
      if (String(v[k] ?? '') !== String(orig[k] ?? '')) changed[k] = v[k] ?? '';
    });
    if (!Object.keys(changed).length) { s.close(); onSaved?.(); return; }
    for (const c of pendingCities) {
      if (String(v.City || '').toLowerCase() === c.toLowerCase()) await enqueue('addListValue', { column: 'City', value: c });
    }
    const keyCol = KEY[tab] || 'ID';
    if (isNew && PREFIX[tab]) changed.ID = newId(PREFIX[tab]);
    await enqueue('upsert', { tab, key: isNew ? null : orig[keyCol], values: changed });
    toast(navigator.onLine ? 'Saved. Syncing to the Sheet…' : 'Saved on this phone. It will sync when you are online.');
    s.close();
    onSaved?.();
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });

  const s = sheet(`${isNew ? 'Add' : 'Edit'} ${TAB_TITLES[tab] || tab}`, form);
  return s;
}

export function newId(prefix) {
  const a = new Uint8Array(4);
  crypto.getRandomValues(a);
  return `${prefix}-${[...a].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function collect(form, fields, values) {
  const out = { ...values };
  fields.forEach((f) => {
    const get = form.querySelector(`[data-col="${CSS.escape(f.col)}"]`)?._get;
    if (get) Object.assign(out, get());
  });
  return out;
}

function fieldEl(f, values, pendingCities, tab) {
  const label = f.label || (f.type === 'location' ? 'Map location' : f.col);
  // Fields with several controls use a div: a <label> would forward taps on it to the first button inside.
  const multi = ['who', 'location', 'datetime', 'city', 'place', 'attachment', 'group'].includes(f.type);
  const wrap = h(multi ? 'div' : 'label', { class: 'field', dataset: { col: f.col }, role: multi ? 'group' : null, 'aria-label': multi ? label : null }, h('span', null, label, f.req ? ' *' : '', f.hint ? h('span', { class: 'hint' }, ` (${f.hint})`) : null));
  const v = values[f.col] ?? '';
  const name = f.col;
  let input;
  switch (f.type) {
    case 'date': {
      input = h('input', { type: 'date', name, value: parseDate(v) || '' });
      wrap._get = () => ({ [f.col]: input.value });
      break;
    }
    case 'time': {
      input = h('input', { type: 'time', name, value: parseTime(v) || '', step: 300 });
      wrap._get = () => ({ [f.col]: input.value });
      break;
    }
    case 'datetime': {
      const d = h('input', { type: 'date', 'aria-label': `${label} date`, value: parseDate(v) || '' });
      const t = h('input', { type: 'time', 'aria-label': `${label} time`, value: parseTime(v) || '', step: 300 });
      input = h('div', { class: 'two' }, d, t);
      wrap._get = () => ({ [f.col]: d.value ? `${d.value} ${t.value || '23:59'}` : '' });
      break;
    }
    case 'number': {
      input = h('input', { type: 'number', inputmode: 'numeric', min: 0, name, value: String(v) });
      wrap._get = () => ({ [f.col]: input.value });
      break;
    }
    case 'url': {
      input = h('input', { type: 'url', inputmode: 'url', name, value: String(v), placeholder: 'https://' });
      wrap._get = () => ({ [f.col]: input.value.trim() });
      break;
    }
    case 'textarea': {
      input = h('textarea', { name }, String(v));
      wrap._get = () => ({ [f.col]: input.value.trim() });
      break;
    }
    case 'color': {
      input = h('input', { type: 'color', name, value: /^#[0-9a-f]{6}$/i.test(v) ? v : '#888888', style: { width: '60px', height: '44px', border: 0, background: 'none' } });
      wrap._get = () => ({ [f.col]: input.value.toUpperCase() });
      break;
    }
    case 'select': {
      const opts = f.opts();
      const sel = h('select', { name }, h('option', { value: '' }, '—'), opts.map((o) => h('option', { value: o }, o)));
      if (v && !opts.includes(String(v))) sel.append(h('option', { value: v }, v));
      sel.value = String(v);
      input = sel;
      wrap._get = () => ({ [f.col]: sel.value });
      break;
    }
    case 'city':
    case 'place': {
      // City dropdown from Lists, with "Other…" to type a new one (added to Lists on save).
      // "place" (transport From/To) also allows stations etc. as free text.
      const cities = state.model.cities.map((c) => c.name);
      const sel = h('select', { name }, h('option', { value: '' }, '—'), cities.map((c) => h('option', { value: c }, c)), h('option', { value: '__other' }, f.type === 'place' ? 'Other place (station, airport…)' : 'Other city…'));
      const other = h('input', { type: 'text', placeholder: f.type === 'place' ? 'e.g. Haneda Airport' : 'New city name', class: 'hidden', style: { marginTop: '6px' } });
      const addToLists = h('label', { class: 'row small hidden', style: { marginTop: '6px' } }, h('input', { type: 'checkbox', checked: f.type === 'city' }), 'Add this city to the Lists tab');
      const known = cities.some((c) => c.toLowerCase() === String(v).toLowerCase());
      if (v && !known) { sel.value = '__other'; other.value = v; other.classList.remove('hidden'); if (f.type === 'city') addToLists.classList.remove('hidden'); } else sel.value = known ? cities.find((c) => c.toLowerCase() === String(v).toLowerCase()) : '';
      sel.addEventListener('change', () => {
        const o = sel.value === '__other';
        other.classList.toggle('hidden', !o);
        addToLists.classList.toggle('hidden', !o || f.type !== 'city');
        if (o) other.focus();
      });
      input = h('div', null, sel, other, addToLists);
      wrap._get = () => {
        if (sel.value !== '__other') return { [f.col]: sel.value };
        const val = other.value.trim();
        if (val && f.type === 'city' && addToLists.querySelector('input').checked) pendingCities.add(val);
        return { [f.col]: val };
      };
      break;
    }
    case 'group': {
      // A person's group, usually their family (parents and children). Using its name in Who includes everyone in it.
      const names = state.model.groups.map((x) => x.name);
      const sel = h('select', { name }, h('option', { value: '' }, 'No group'), names.map((n) => h('option', { value: n }, n)), h('option', { value: '__new' }, 'New group…'));
      const other = h('input', { type: 'text', placeholder: 'e.g. Saito family', class: 'hidden', style: { marginTop: '6px' } });
      if (v && !names.includes(String(v))) sel.append(h('option', { value: v }, v));
      sel.value = String(v);
      sel.addEventListener('change', () => { other.classList.toggle('hidden', sel.value !== '__new'); if (sel.value === '__new') other.focus(); });
      input = h('div', null, sel, other);
      wrap._get = () => ({ [f.col]: sel.value === '__new' ? other.value.trim() : sel.value });
      break;
    }
    case 'who': {
      input = whoPicker(String(v), f.peopleOnly);
      wrap._get = () => ({ [f.col]: input._value() });
      break;
    }
    case 'location': {
      input = locationField(values, f);
      wrap._get = () => input._value();
      break;
    }
    case 'attachment': {
      input = h('div', null, h('button', { type: 'button', class: 'btn small', onclick: () => openAttachment(String(v)) }, icon('clip', 18), 'View the uploaded file'));
      wrap._get = () => ({ [f.col]: v });
      break;
    }
    default: {
      input = h('input', { type: 'text', name, value: String(v), autocomplete: 'off' });
      wrap._get = () => ({ [f.col]: input.value.trim() });
    }
  }
  wrap.append(input);
  return wrap;
}

/** Tap-to-toggle chips for groups and people. Stored as "Everyone" or "Avery, Blake, Kit". */
function whoPicker(current, peopleOnly) {
  const m = state.model;
  const res = m.resolveWho(current);
  const sel = new Set(current.trim() ? res.people : []);
  const unknown = res.unknown;
  const peopleRow = h('div', { class: 'toggle-chips', role: 'group', 'aria-label': 'People' });
  const groupRow = h('div', { class: 'toggle-chips', role: 'group', 'aria-label': 'Groups', style: { marginBottom: '8px' } });
  const summary = h('div', { class: 'small muted', style: { marginTop: '6px' }, 'aria-live': 'polite' });
  const draw = () => {
    peopleRow.replaceChildren(...m.people.map((p) => h('button', { type: 'button', 'aria-pressed': String(sel.has(p.name)), onclick: () => { sel.has(p.name) ? sel.delete(p.name) : sel.add(p.name); draw(); } },
      h('span', { class: 'sw', style: { background: p.color } }), p.name, p.child ? h('span', { class: 'muted small' }, p.age !== null ? ` (${p.age})` : ' (child)') : null)));
    if (!peopleOnly) {
      groupRow.replaceChildren(...[m.everyone, ...m.groups].map((g) => {
        const on = g.members.length && g.members.every((x) => sel.has(x));
        return h('button', { type: 'button', 'aria-pressed': String(on), onclick: () => { if (on) g.members.forEach((x) => sel.delete(x)); else g.members.forEach((x) => sel.add(x)); draw(); } }, g.name);
      }));
    }
    summary.textContent = sel.size ? m.partySummary([...sel]) : '';
  };
  draw();
  const box = h('div', null, peopleOnly ? null : groupRow, peopleRow, summary,
    unknown.length ? h('div', { class: 'err' }, `Not recognized (kept as typed): ${unknown.join(', ')}`) : null);
  box._value = () => {
    const names = m.people.map((p) => p.name).filter((n) => sel.has(n));
    // "Everyone" only when every person in the People tab is picked
    if (!peopleOnly && names.length && names.length === m.people.length) return ['Everyone', ...unknown].join(', ');
    // Unchanged selection: keep the original text (e.g. a group name)
    const same = current.trim() && names.length === res.people.length && names.every((n) => res.people.includes(n)) && !unknown.length;
    if (same) return current;
    if (!peopleOnly) {
      const g = m.groups.find((x) => x.members.length === names.length && x.members.every((n) => sel.has(n)));
      if (g && names.length) return [g.name, ...unknown].join(', ');
    }
    return [...names, ...unknown].join(', ');
  };
  return box;
}

/** Shows the pin location and lets people paste a Google Maps link or "lat, lng" to fix it. */
function locationField(values, f) {
  const latCol = f.col, lngCol = f.lng;
  let lat = values[latCol] ?? '', lng = values[lngCol] ?? '';
  const status = h('div', { class: 'small muted' });
  const input = h('input', { type: 'text', placeholder: 'Paste a Google Maps link or 35.0116, 135.7681', autocomplete: 'off', inputmode: 'url' });
  const draw = () => {
    status.replaceChildren(lat !== '' && lng !== ''
      ? h('span', null, `Pinned at ${(+lat).toFixed(5)}, ${(+lng).toFixed(5)} `, h('button', { type: 'button', class: 'link', onclick: () => { lat = ''; lng = ''; draw(); } }, 'clear (look up from address)'))
      : 'No pin yet: found from the address or name when saved (needs internet), or paste a link below.');
  };
  draw();
  const use = h('button', { type: 'button', class: 'btn small', onclick: async () => {
    const t = input.value.trim();
    if (!t) return;
    let loc = parseLocation(t);
    if (!loc) {
      if (!navigator.onLine) { toast('Short links need internet. Paste the full link or coordinates instead.'); return; }
      use.disabled = true;
      try { loc = await resolveLocation(t); } catch { loc = null; }
      use.disabled = false;
    }
    if (!loc) { toast('Could not find a location in that text.'); return; }
    lat = loc.lat; lng = loc.lng; input.value = ''; draw();
    toast('Pin set.');
  } }, 'Use');
  const box = h('div', null, status, h('div', { class: 'row', style: { marginTop: '6px', flexWrap: 'nowrap' } }, input, use));
  box._value = () => ({ [latCol]: lat, [lngCol]: lng });
  return box;
}

/** Restaurant idea -> reservation: asks for the booking details. */
export function openMoveIdea(idea) {
  const vals = { Date: state.date || '', Time: '', Who: '' };
  const fields = [
    { col: 'Date', type: 'date', req: true, half: true }, { col: 'Time', type: 'time', half: true },
    { col: 'Who', type: 'who', req: true }, { col: 'Party size', type: 'number', half: true },
    { col: 'Status', type: 'select', opts: statusOpts, half: true },
    { col: 'Cancellation deadline', type: 'datetime' }, { col: 'Confirmation #', type: 'text' },
  ];
  vals.Status = 'Tentative';
  const form = h('form', null, h('p', { class: 'muted' }, `Creates a reservation for ${idea.Name}${idea.City ? ` in ${idea.City}` : ''} and marks the idea as Confirmed.`));
  let pair = null;
  fields.forEach((f) => {
    const el = fieldEl(f, vals, new Set(), 'Reservations');
    if (f.half) { if (!pair) { pair = h('div', { class: 'two' }); form.append(pair); } pair.append(el); if (pair.children.length === 2) pair = null; } else { pair = null; form.append(el); }
  });
  form.append(h('div', { class: 'form-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => s.close() }, 'Close'), h('button', { type: 'submit', class: 'btn primary' }, 'Move to Reservations')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = collect(form, fields, vals);
    if (!v.Date) { toast('Pick a date.'); return; }
    const whoEl = form.querySelector('[data-col="Who"]');
    whoEl.querySelector('.err')?.remove();
    if (!String(v.Who || '').trim()) { whoEl.append(h('div', { class: 'err' }, 'Pick who is going')); return; }
    const reservation = { ID: newId('R') };
    Object.entries(v).forEach(([k, x]) => { if (x !== '') reservation[k] = x; });
    await enqueue('moveIdea', { ideaId: idea.ID, reservation });
    toast('Moved to Reservations.');
    s.close();
  });
  const s = sheet('Move to Reservations', form);
}

/** "What do you want to add?" chooser. */
export function openAddMenu() {
  const opts = [
    ['Reservations', 'Reservation', 'reservation'], ['Transport', 'Transport', 'transport'], ['Stays', 'Stay', 'stay'],
    ['Notes', 'Note', 'note'], ['Restaurant ideas', 'Restaurant idea', 'idea'],
  ];
  const body = h('div', null,
    h('button', { class: 'btn primary', style: { width: '100%', justifyContent: 'flex-start', marginBottom: '6px' }, onclick: () => { s.close(); openImport(); } },
      icon('import'), 'Import from a file or pasted text'),
    h('p', { class: 'small muted', style: { margin: '0 0 12px' } }, 'A confirmation email, PDF or screenshot: Claude fills in the form for you to check.'),
    h('div', { class: 'section-title' }, 'Or add by hand'),
    h('div', { style: { display: 'grid', gap: '8px' } }, opts.map(([tab, label, ic]) => h('button', { class: 'btn', style: { justifyContent: 'flex-start' }, onclick: () => { s.close(); openEditor(tab); } }, icon(ic), label))),
    h('div', { class: 'section-title' }, 'Less often'),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => { s.close(); openEditor('People'); } }, 'Person'),
      h('button', { class: 'btn small', onclick: () => { s.close(); openListAdd(); } }, 'Dropdown choice (Lists)')));
  const s = sheet('Add to the trip', body);
}

/** Adds a value to one of the Lists columns (e.g. a new city or reservation type). */
export function openListAdd() {
  const cols = Object.keys(state.model.lists).filter((c) => !/Lat$|Lng$/.test(c));
  const sel = h('select', null, cols.map((c) => h('option', { value: c }, c)));
  const val = h('input', { type: 'text', placeholder: 'New choice' });
  const loc = h('input', { type: 'text', placeholder: 'Optional: Google Maps link or lat, lng for the city' });
  const locField = h('label', { class: 'field' }, h('span', null, 'City location'), loc);
  sel.value = cols.includes('City') ? 'City' : cols[0];
  const sync = () => locField.classList.toggle('hidden', sel.value !== 'City');
  sel.addEventListener('change', sync);
  sync();
  const form = h('form', null,
    h('label', { class: 'field' }, h('span', null, 'List'), sel),
    h('label', { class: 'field' }, h('span', null, 'Value *'), val), locField,
    h('div', { class: 'form-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => s.close() }, 'Close'), h('button', { type: 'submit', class: 'btn primary' }, 'Add')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!val.value.trim()) { val.focus(); return; }
    const extra = {};
    const p = sel.value === 'City' ? parseLocation(loc.value) : null;
    if (p) { extra['City Lat'] = p.lat; extra['City Lng'] = p.lng; }
    await enqueue('addListValue', { column: sel.value, value: val.value.trim(), extra });
    toast(`Added to ${sel.value}.`);
    s.close();
  });
  const s = sheet('Add a dropdown choice', form);
}
