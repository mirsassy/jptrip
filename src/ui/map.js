// Map of stays, transport endpoints, reservations, notes and restaurant ideas,
// colored by the people involved. Uses MapLibre with OpenFreeMap tiles (free,
// no key). Tiles are cached by the service worker only as they are viewed.
import { h, icon, clear } from './dom.js';
import { state, setDate } from '../lib/store.js';
import { makePass } from '../lib/filters.js';
import { tripDays, dayGroups } from '../lib/model.js';
import { fmtDay, fmtShort, jpNow, addDays } from '../lib/dates.js';
import { conic, whoChips, statusBadge, googleMapsLink, itemTimeLabel } from './common.js';
import { openEditor } from './forms.js';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const JAPAN = { center: [137.5, 36.0], zoom: 4.6 };

let maplibre = null;
let map = null;
let markers = [];
let allDates = false; // the full-screen map opens on the whole trip; the map beside the day view follows the day
const showIdeas = false; // ideas are listed in the Ideas tab and on each day, not on the map
let lastFitKey = '';
let container = null;
let controls = null;
let note = null;
let mapError = false;
let waitingForIdle = false;

async function loadMaplibre() {
  const base = new URL('./vendor/maplibre/', document.baseURI).href;
  if (!document.querySelector('link[data-maplibre]')) {
    document.head.append(h('link', { rel: 'stylesheet', href: `${base}maplibre-gl.css`, 'data-maplibre': '' }));
  }
  return import(/* @vite-ignore */ `${base}maplibre-gl.mjs`);
}

/** `wholeTrip`: the full-screen map shows the whole trip; the map beside the day view follows the chosen day. */
export async function renderMap(root, { wholeTrip = false } = {}) {
  if (wholeTrip !== allDates) { allDates = wholeTrip; lastFitKey = ''; controlsSig = ''; }
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
  // Redraw now if the style is ready, otherwise as soon as the map settles (tiles may still be loading)
  if (map.isStyleLoaded()) drawMarkers();
  else if (!waitingForIdle) { waitingForIdle = true; map.once('idle', () => { waitingForIdle = false; drawMarkers(); }); }
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
    dateLabel.textContent = allDates ? 'Whole trip' : fmtDay(state.date);
    if (document.activeElement !== slider) slider.value = idx;
    return;
  }
  controlsSig = sig;
  slider = h('input', { type: 'range', min: 0, max: Math.max(0, days.length - 1), value: idx, 'aria-label': 'Trip day', disabled: allDates,
    oninput: (e) => setDate(days[+e.target.value]) });
  dateLabel = h('span', { style: { minWidth: '84px', textAlign: 'center', fontWeight: 600, fontSize: '.9rem' }, 'aria-live': 'polite' }, allDates ? 'Whole trip' : fmtDay(state.date));
  clear(controls).append(
    h('div', { class: 'ctl' },
      h('button', { class: 'icon-btn', 'aria-label': 'Previous day', disabled: allDates, onclick: () => setDate(addDays(state.date, -1)) }, icon('chevl', 18)),
      dateLabel,
      h('button', { class: 'icon-btn', 'aria-label': 'Next day', disabled: allDates, onclick: () => setDate(addDays(state.date, 1)) }, icon('chevr', 18)),
      slider),
  );
  // The full-screen map has its own filters instead of the day controls
  controls.classList.toggle('whole-trip', allDates);
  if (allDates) drawTripFilters(days);
}

/** Items to show: for one date, where everyone sleeps that night plus that day's plans. */
/* Filters of the full-screen (whole-trip) map: one day or all, people, kinds of plan, country. */
const tripFilter = { day: '', people: [], kinds: ['stay', 'transport', 'reservation'], country: 'all' };
let filtersOpen = false;
const KINDS = [['stay', 'Hotels'], ['transport', 'Travel'], ['reservation', 'Bookings']];
const inJapan = (loc) => !!loc && loc.lat > 24 && loc.lat < 46.2 && loc.lng > 122.5 && loc.lng < 154;
const countryOk = (loc) => tripFilter.country === 'all' || !loc || (tripFilter.country === 'japan' ? inJapan(loc) : !inJapan(loc));

function drawTripFilters(days) {
  const m = state.model;
  const n = (tripFilter.day ? 1 : 0) + (tripFilter.people.length ? 1 : 0) + (tripFilter.kinds.length < 3 ? 1 : 0) + (tripFilter.country !== 'all' ? 1 : 0);
  const redraw = () => { controlsSig = ''; lastFitKey = ''; drawControls(); drawMarkers(true); };
  const daySel = h('select', { 'aria-label': 'Dates', onchange: (e) => { tripFilter.day = e.target.value; redraw(); } },
    h('option', { value: '' }, 'Whole trip'), days.map((d) => h('option', { value: d }, fmtDay(d))));
  daySel.value = tripFilter.day;
  const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const abroad = m.items.some((it) => [it.loc, it.fromLoc, it.toLoc].some((l) => l && !l.approx && !inJapan(l)));
  const panel = h('div', { class: 'ctl map-filters', hidden: !filtersOpen },
    h('div', { class: 'small muted' }, 'People'),
    h('div', { class: 'toggle-chips' }, m.people.map((p) => h('button', { 'aria-pressed': String(tripFilter.people.includes(p.name)), onclick: () => { tripFilter.people = toggle(tripFilter.people, p.name); redraw(); } },
      h('span', { class: 'sw', style: { background: p.color } }), p.name))),
    h('div', { class: 'small muted' }, 'Show'),
    h('div', { class: 'toggle-chips' }, KINDS.map(([k, label]) => h('button', { 'aria-pressed': String(tripFilter.kinds.includes(k)), onclick: () => { tripFilter.kinds = toggle(tripFilter.kinds, k); redraw(); } }, label))),
    abroad ? h('div', { class: 'small muted' }, 'Country') : null,
    abroad ? h('div', { class: 'toggle-chips' }, [['all', 'All'], ['japan', 'Japan'], ['abroad', 'Outside Japan']].map(([k, label]) => h('button', { 'aria-pressed': String(tripFilter.country === k), onclick: () => { tripFilter.country = k; redraw(); } }, label))) : null,
    n ? h('button', { class: 'link small', onclick: () => { Object.assign(tripFilter, { day: '', people: [], kinds: KINDS.map(([k]) => k), country: 'all' }); redraw(); } }, 'Clear filters') : null);
  clear(controls).append(
    h('div', { class: 'ctl', style: { padding: '4px 6px' } }, daySel,
      h('button', { class: 'btn small', 'aria-expanded': String(filtersOpen), onclick: () => { filtersOpen = !filtersOpen; panel.hidden = !filtersOpen; } }, icon('filter', 14), n ? `Filters (${n})` : 'Filters')),
    panel);
}

function visibleItems() {
  const m = state.model;
  const date = allDates ? tripFilter.day : state.date;
  const pass = makePass(m, state.filters, { ignoreDates: !allDates });
  return m.items.filter((it) => {
    if (!pass(it)) return false;
    if (it.type === 'idea') return showIdeas;
    if (allDates) {
      if (!tripFilter.kinds.includes(it.type)) return false;
      if (tripFilter.people.length && !it.people.some((p) => tripFilter.people.includes(p))) return false;
      if (!date) return true;
    }
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
    h('div', { class: 'links' }, googleMapsLink(endLabel ? { type: 'stay', title: endLabel === 'From' ? it.from : it.to, loc, address: '', city: '' } : it),
      h('button', { class: 'btn small', onclick: () => openEditor(it.tab, it.raw) }, icon('edit', 14), 'Edit')));
}

let markersSig = '';
function drawMarkers(fit = false) {
  if (!map || !maplibre) return;
  const items = visibleItems();
  // Nothing changed (e.g. a background sync): keep the pins, so an open popup stays open
  const sig = `${allDates}|${state.date}|${JSON.stringify(tripFilter)}|${items.map((it) => `${it.id}:${it.status}:${it.people.join(',')}:${it.loc?.lat},${it.loc?.lng}:${it.fromLoc?.lat}:${it.toLoc?.lat}`).join('|')}`;
  if (sig === markersSig && markers.length) return; // also when asked to reframe: rebuilding would close an open popup
  markersSig = sig;
  markers.forEach((mk) => mk.remove());
  markers = [];
  const points = [];
  const routes = [];
  items.forEach((it) => {
    if (it.type === 'transport') {
      if (it.fromLoc) points.push({ it, loc: it.fromLoc, end: 'From' });
      if (it.toLoc) points.push({ it, loc: it.toLoc, end: 'To' });
      if (it.fromLoc && it.toLoc) routes.push(leg(it.fromLoc, it.toLoc, { color: it.people.length === 1 ? state.model.peopleByName.get(it.people[0])?.color : '#5b5550', kind: 'travel', title: it.title, date: it.date }));
    } else if (it.type === 'stay' && it.loc) {
      // One pin per hotel, even when it is booked in several rows (e.g. one per family)
      const same = points.find((p) => p.it.type === 'stay' && p.it.lodging === it.lodging);
      if (same) same.people = [...new Set([...same.people, ...it.people])];
      else points.push({ it, loc: it.loc, people: it.people.slice() });
    } else if (it.loc) {
      points.push({ it, loc: it.loc });
    }
  });

  if (allDates && tripFilter.country !== 'all') {
    for (let i = points.length - 1; i >= 0; i--) if (!countryOk(points[i].loc)) points.splice(i, 1);
  }

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
    const el = pinEl(p.it, p.people || p.it.people, p.loc.approx, label);
    const mk = new maplibre.Marker({ element: el, anchor: 'bottom-left', offset: [p.px[0] - 2, p.px[1] + 2] })
      .setLngLat([p.loc.lng, p.loc.lat])
      .setPopup(new maplibre.Popup({ offset: [p.px[0] + 12, p.px[1] - 24], maxWidth: '300px' }).setDOMContent(popup(p.people ? { ...p.it, people: p.people } : p.it, p.loc, p.end)))
      .addTo(map);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') mk.togglePopup(); });
    markers.push(mk);
  });

  // Whole trip: also the moves between stays that have no travel row (e.g. by car), dotted
  if (allDates && !tripFilter.day && tripFilter.kinds.includes('stay')) routes.push(...impliedLegs(items));
  if (allDates && tripFilter.country !== 'all') {
    for (let i = routes.length - 1; i >= 0; i--) {
      const [a, b] = routes[i].geometry.coordinates;
      if (!countryOk({ lng: a[0], lat: a[1] }) && !countryOk({ lng: b[0], lat: b[1] })) routes.splice(i, 1);
    }
  }
  routes.forEach((f) => {
    const [a, b] = f.geometry.coordinates;
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) < 0.02) return; // too short to draw an arrow
    const el = h('div', { class: `route-arrow ${f.properties.kind}`, title: `${fmtShort(f.properties.date)}: ${f.properties.title}`, 'aria-hidden': 'true' }, '➤');
    markers.push(new maplibre.Marker({ element: el, rotation: bearing(a, b), rotationAlignment: 'map' }).setLngLat(midpoint(a, b)).addTo(map));
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
  map.addLayer({ id: 'routes', type: 'line', source: 'routes', filter: ['==', ['get', 'kind'], 'travel'], paint: { 'line-color': ['coalesce', ['get', 'color'], '#5b5550'], 'line-width': 3, 'line-dasharray': [2, 1.5], 'line-opacity': 0.85 } });
  map.addLayer({ id: 'routes-implied', type: 'line', source: 'routes', filter: ['==', ['get', 'kind'], 'implied'], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#5b5550', 'line-width': 2.5, 'line-dasharray': [0.1, 2], 'line-opacity': 0.7 } });
}

function leg(from, to, props) {
  return { type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: [[from.lng, from.lat], [to.lng, to.lat]] } };
}

/**
 * Moves between consecutive stays (per person) in different places, when no travel row
 * covers them: the drive from one hotel to the next. Same move for several people = one line.
 */
function impliedLegs(items) {
  const stays = items.filter((it) => it.type === 'stay' && it.loc && it.status !== 'Cancelled');
  const travel = items.filter((it) => it.type === 'transport');
  const seen = new Set();
  const out = [];
  state.model.people.forEach((p) => {
    const mine = stays.filter((s) => s.people.includes(p.name)).sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < mine.length; i++) {
      const a = mine[i - 1], b = mine[i];
      if ((a.city || a.title) === (b.city || b.title)) continue;
      const covered = travel.some((t) => t.people.includes(p.name) && t.date >= a.date && t.date <= b.date);
      if (covered) continue;
      const k = `${a.id}>${b.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(leg(a.loc, b.loc, { kind: 'implied', title: `${a.city || a.title} → ${b.city || b.title}`, date: b.date }));
    }
  });
  return out;
}

const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** Compass bearing from a to b in Web Mercator, so the arrow points along the line on screen. */
function bearing(a, b) {
  const y = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const dx = b[0] - a[0];
  const dy = (y(b[1]) - y(a[1])) * (180 / Math.PI);
  return -(Math.atan2(dy, dx) * 180) / Math.PI; // clockwise degrees; the ➤ glyph points east
}

/** Called on every state change while the map is visible. */
export function updateMap() {
  if (!container) return;
  drawControls();
  if (map && map.isStyleLoaded()) drawMarkers();
}
