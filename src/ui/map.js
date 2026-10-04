// Map of stays, transport endpoints, reservations, notes and restaurant ideas,
// colored by the people involved. Uses MapLibre with OpenFreeMap tiles (free,
// no key). Tiles are cached by the service worker only as they are viewed.
import { h, icon, clear } from './dom.js';
import { state, setDate, setFilters } from '../lib/store.js';
import { makePass } from '../lib/filters.js';
import { tripDays, dayGroups } from '../lib/model.js';
import { fmtDay, fmtShort, jpNow, addDays } from '../lib/dates.js';
import { conic, whoChips, statusBadge, mapLinks, itemTimeLabel } from './common.js';
import { openEditor } from './forms.js';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const JAPAN = { center: [137.5, 36.0], zoom: 4.6 };

let maplibre = null;
let map = null;
let markers = [];
let allDates = false;
let showIdeas = true;
let lastFitKey = '';
let container = null;
let controls = null;
let note = null;
let mapError = false;

async function loadMaplibre() {
  const base = new URL('./vendor/maplibre/', document.baseURI).href;
  if (!document.querySelector('link[data-maplibre]')) {
    document.head.append(h('link', { rel: 'stylesheet', href: `${base}maplibre-gl.css`, 'data-maplibre': '' }));
  }
  return import(/* @vite-ignore */ `${base}maplibre-gl.mjs`);
}

export async function renderMap(root) {
  if (!container) {
    container = h('div', { id: 'map', role: 'region', 'aria-label': 'Trip map' });
    controls = h('div', { class: 'map-controls' });
    note = h('div', { class: 'map-note hidden' });
    root.append(container, controls, note);
  }
  drawControls();
  if (!map) {
    try {
      maplibre = await loadMaplibre();
      map = new maplibre.Map({ container, style: STYLE_URL, ...JAPAN, attributionControl: { compact: true }, cooperativeGestures: false });
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'bottom-right');
      map.on('error', (e) => {
        if (!mapError && (!navigator.onLine || /Failed to fetch|NetworkError|Load failed/i.test(String(e?.error?.message)))) {
          mapError = true;
          showNote(navigator.onLine ? 'Some map tiles could not load.' : 'Offline: only map areas you viewed before are available. Pins still work.');
        }
      });
      map.on('load', () => { addRouteLayer(); drawMarkers(true); });
      window.addEventListener('online', () => { mapError = false; showNote(''); });
    } catch (e) {
      showNote('The map could not start on this device.');
      return;
    }
  }
  if (map.loaded() || map.isStyleLoaded()) drawMarkers();
  requestAnimationFrame(() => map.resize());
}

function showNote(text) {
  note.textContent = text;
  note.classList.toggle('hidden', !text);
}

let controlsSig = '';
let dateLabel = null;
let slider = null;

function drawControls() {
  const m = state.model;
  const days = tripDays(m, jpNow().date);
  const idx = Math.max(0, days.indexOf(state.date));
  const sig = `${days[0]}|${days.length}|${allDates}|${showIdeas}|${state.filters.kidOnly}`;
  if (sig === controlsSig && slider) {
    // Only the date changed: update in place so a drag on the slider is not interrupted
    dateLabel.textContent = allDates ? 'All dates' : fmtDay(state.date);
    if (document.activeElement !== slider) slider.value = idx;
    return;
  }
  controlsSig = sig;
  slider = h('input', { type: 'range', min: 0, max: Math.max(0, days.length - 1), value: idx, 'aria-label': 'Trip day', disabled: allDates,
    oninput: (e) => setDate(days[+e.target.value]) });
  dateLabel = h('span', { style: { minWidth: '84px', textAlign: 'center', fontWeight: 600, fontSize: '.9rem' }, 'aria-live': 'polite' }, allDates ? 'All dates' : fmtDay(state.date));
  clear(controls).append(
    h('div', { class: 'ctl' },
      h('button', { class: 'icon-btn', 'aria-label': 'Previous day', disabled: allDates, onclick: () => setDate(addDays(state.date, -1)) }, icon('chevl', 18)),
      dateLabel,
      h('button', { class: 'icon-btn', 'aria-label': 'Next day', disabled: allDates, onclick: () => setDate(addDays(state.date, 1)) }, icon('chevr', 18)),
      slider),
    h('div', { class: 'ctl toggle-chips', style: { padding: '4px' } },
      h('button', { 'aria-pressed': String(allDates), onclick: () => { allDates = !allDates; lastFitKey = ''; drawControls(); drawMarkers(true); } }, 'All dates'),
      h('button', { 'aria-pressed': String(showIdeas), onclick: () => { showIdeas = !showIdeas; drawControls(); drawMarkers(); } }, icon('idea', 14), 'Ideas'),
      showIdeas ? h('button', { 'aria-pressed': String(state.filters.kidOnly), onclick: () => setFilters({ kidOnly: !state.filters.kidOnly }) }, icon('kid', 14), 'Kid-friendly') : null));
}

/** Items to show: for one date, where everyone sleeps that night plus that day's plans. */
function visibleItems() {
  const m = state.model;
  const date = state.date;
  const pass = makePass(m, state.filters, { ignoreDates: !allDates });
  return m.items.filter((it) => {
    if (!pass(it)) return false;
    if (it.type === 'idea') return showIdeas;
    if (allDates) return true;
    if (it.type === 'stay') return it.date <= date && date < it.endDate;
    return it.date === date;
  });
}

function pinEl(it, people, approx, label) {
  const bg = it.type === 'idea' ? '#6b655e' : people.length ? `conic-gradient(${conic(people)})` : '#888';
  const el = h('div', { class: `pin ${it.type === 'idea' ? 'idea' : ''} ${approx ? 'approx' : ''} ${it.status === 'Cancelled' ? 'cancelled' : ''}`, style: { background: bg }, role: 'button', tabindex: 0, 'aria-label': label },
    h('span', null, icon(it.type === 'stay' ? 'stay' : it.type === 'transport' ? 'transport' : it.type === 'reservation' ? 'reservation' : it.type === 'note' ? 'note' : 'idea', it.type === 'idea' ? 12 : 15)));
  return el;
}

function popup(it, loc, endLabel) {
  const when = it.type === 'stay' ? `${fmtShort(it.date)} → ${fmtShort(it.endDate)}` : [it.date ? fmtDay(it.date) : '', itemTimeLabel(it)].filter(Boolean).join(' · ');
  return h('div', { class: 'popup' },
    h('h4', null, endLabel ? `${endLabel}: ${endLabel === 'From' ? it.from : it.to}` : it.title),
    endLabel ? h('div', { class: 'small' }, it.title) : null,
    h('div', { class: 'small muted' }, [when, it.type !== 'transport' ? it.city : ''].filter(Boolean).join(' · ')),
    h('div', { class: 'row', style: { margin: '6px 0' } }, statusBadge(it.status), it.type === 'idea' && it.kid === 'Yes' ? h('span', { class: 'chip' }, 'Kid-friendly') : null),
    it.type === 'idea' ? null : whoChips(it.people, { max: 6 }),
    loc.approx ? h('div', { class: 'small muted', style: { marginTop: '6px' } }, 'Pin is at the city center: add an address or paste a map link to place it.') : null,
    h('div', { class: 'links' }, mapLinks(endLabel ? { ...it, title: endLabel === 'From' ? it.from : it.to, address: '', city: '' } : it, loc),
      h('button', { class: 'btn small', onclick: () => openEditor(it.tab, it.raw) }, icon('edit', 14), 'Edit')));
}

function drawMarkers(fit = false) {
  if (!map || !maplibre) return;
  markers.forEach((mk) => mk.remove());
  markers = [];
  const items = visibleItems();
  const points = [];
  const routes = [];
  items.forEach((it) => {
    if (it.type === 'transport') {
      if (it.fromLoc) points.push({ it, loc: it.fromLoc, end: 'From' });
      if (it.toLoc) points.push({ it, loc: it.toLoc, end: 'To' });
      if (it.fromLoc && it.toLoc) routes.push({ type: 'Feature', properties: { color: it.people.length === 1 ? state.model.peopleByName.get(it.people[0])?.color : '#5b5550' }, geometry: { type: 'LineString', coordinates: [[it.fromLoc.lng, it.fromLoc.lat], [it.toLoc.lng, it.toLoc.lat]] } });
    } else if (it.loc) {
      points.push({ it, loc: it.loc });
    }
  });

  // Pins that share a spot (e.g. several at a city center) are fanned out on screen so each can be tapped
  const byKey = new Map();
  points.forEach((p) => {
    const k = `${p.loc.lat.toFixed(4)},${p.loc.lng.toFixed(4)}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(p);
  });
  byKey.forEach((list) => {
    list.forEach((p, i) => {
      if (list.length === 1) { p.px = [0, 0]; return; }
      const a = (2 * Math.PI * i) / list.length - Math.PI / 2;
      const r = 16 + 3 * list.length;
      p.px = [Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a))];
    });
  });

  points.forEach((p) => {
    const label = `${p.end ? `${p.end} ` : ''}${p.it.title}`;
    const el = pinEl(p.it, p.it.people, p.loc.approx, label);
    const mk = new maplibre.Marker({ element: el, anchor: 'bottom-left', offset: [p.px[0] - 2, p.px[1] + 2] })
      .setLngLat([p.loc.lng, p.loc.lat])
      .setPopup(new maplibre.Popup({ offset: [p.px[0] + 12, p.px[1] - 24], maxWidth: '300px' }).setDOMContent(popup(p.it, p.loc, p.end)))
      .addTo(map);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') mk.togglePopup(); });
    markers.push(mk);
  });

  const src = map.getSource('routes');
  if (src) src.setData({ type: 'FeatureCollection', features: routes });

  // Where everyone is tonight (legend)
  if (!allDates && state.model.people.length) {
    const groups = dayGroups(state.model, state.date, { pass: () => true });
    showNote(mapError ? note.textContent : groups.map((g) => `${g.label}: ${g.people.length === state.model.people.length ? 'everyone' : g.people.join(', ')}`).join(' · '));
  } else if (!mapError) {
    showNote('');
  }

  const key = `${allDates}|${state.date}|${points.length}`;
  if ((fit || key !== lastFitKey) && points.length) {
    lastFitKey = key;
    const b = new maplibre.LngLatBounds();
    // Frame the day's plans; ideas only when nothing else is shown
    const framed = points.some((p) => p.it.type !== 'idea') ? points.filter((p) => p.it.type !== 'idea') : points;
    framed.forEach((p) => b.extend([p.loc.lng, p.loc.lat]));
    map.fitBounds(b, { padding: { top: 130, bottom: 90, left: 70, right: 70 }, maxZoom: 13, duration: fit ? 0 : 600 });
  }
}

function addRouteLayer() {
  if (map.getSource('routes')) return;
  map.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'routes', type: 'line', source: 'routes', paint: { 'line-color': ['coalesce', ['get', 'color'], '#5b5550'], 'line-width': 3, 'line-dasharray': [2, 1.5], 'line-opacity': 0.8 } });
}

/** Called on every state change while the map is visible. */
export function updateMap() {
  if (!container) return;
  drawControls();
  if (map && map.isStyleLoaded()) drawMarkers();
}
