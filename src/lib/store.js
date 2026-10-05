// App state: the latest Sheet data (kept on the device), the queue of edits
// waiting to be sent, weather, filters, and the selected date.
import { get, set, clear as clearIdb } from 'idb-keyval';
import { buildModel, defaultDate } from './model.js';
import { callApi, loadConfig, saveConfig, ApiError, deviceLabel } from './api.js';
import { loadFilters, saveFilters } from './filters.js';
import { jpNow } from './dates.js';
import { refreshWeather } from './weather.js';

const listeners = new Set();
// Bumped by eraseThisDevice(): work started before an erase must not write trip data back afterwards
let epoch = 0;

export const state = {
  config: loadConfig(),
  data: null,
  model: buildModel(null),
  lastSynced: 0,
  queue: [],
  syncing: false,
  error: null,        // { code, message }
  failedOps: [],
  filters: loadFilters(),
  date: null,
  dateAuto: true,
  weather: {},
  online: navigator.onLine,
};

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((fn) => fn(state)); }

function rebuild() {
  const data = state.data ? applyQueue(state.data, state.queue) : null;
  state.model = buildModel(data);
  state.modelVersion = (state.modelVersion || 0) + 1; // views redraw only when this (or date, filters, weather) changes
  // Until someone picks a date, follow the trip: today during it, its first day before it
  if (!state.date || state.dateAuto) {
    state.date = defaultDate(state.model, jpNow().date);
    state.dateAuto = true;
  }
}

export async function init() {
  try {
    const [data, lastSynced, queue, weather] = await Promise.all([get('data'), get('lastSynced'), get('queue'), get('weather')]);
    state.data = data || null;
    state.lastSynced = lastSynced || 0;
    state.queue = queue || [];
    state.weather = weather || {};
  } catch { /* IndexedDB unavailable or lost (iOS can drop it after the app was in the background) */ }
  // Backup copy: if IndexedDB came back empty, use the one kept in localStorage
  if (!state.data) {
    try {
      const b = JSON.parse(localStorage.getItem(BACKUP_KEY) || 'null');
      if (b?.data) { state.data = b.data; state.lastSynced = b.lastSynced || 0; if (!state.queue.length) state.queue = b.queue || []; }
    } catch { /* no backup */ }
  }
  rebuild();
  emit();
  window.addEventListener('online', () => { state.online = true; emit(); sync(); });
  window.addEventListener('offline', () => { state.online = false; emit(); });
  // Coming back to the app is like opening it: show the latest at once
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync({ apply: true }); });
}

export function setConfig(c) {
  state.config = { ...state.config, ...c };
  saveConfig(state.config);
  emit();
}

export function setFilters(f) {
  state.filters = { ...state.filters, ...f };
  saveFilters(state.filters);
  emit();
}

export function setDate(d) {
  state.date = d;
  state.dateAuto = false;
  emit();
}

const BACKUP_KEY = 'trip.backup.v1';
const persist = (since = epoch) => {
  if (since !== epoch) return Promise.resolve();
  // A second copy in localStorage, in case the browser loses IndexedDB (a known iOS issue)
  try { if (state.data) localStorage.setItem(BACKUP_KEY, JSON.stringify({ data: state.data, queue: state.queue, lastSynced: state.lastSynced })); } catch { /* full: IndexedDB still has it */ }
  return Promise.all([set('data', state.data), set('lastSynced', state.lastSynced), set('queue', state.queue)]).catch(() => {});
};

/** Same trip content (ignores the server's timestamp). */
function sameTrip(a, b) {
  if (!a || !b) return false;
  return JSON.stringify({ ...a, serverTime: 0 }) === JSON.stringify({ ...b, serverTime: 0 });
}

/** Shows the changes someone else made, held back while the app was in use. */
export function applyPendingUpdate() {
  if (!state.pendingData) return;
  state.data = state.pendingData;
  state.pendingData = null;
  persist();
  rebuild();
  emit();
  refreshWeatherNow();
}

let syncPromise = null;
/** Sends queued edits in order, then reads the whole Sheet. */
/**
 * `apply`: show what the Sheet sends right away (opening the app, tapping sync, after your own
 * edits). Otherwise (background syncs) someone else's changes wait behind a "Show changes" banner,
 * so the screen never changes under the person using it.
 */
export function sync({ apply = false } = {}) {
  if (syncPromise) return syncPromise;
  if (!state.config.url || !state.config.token) return Promise.resolve();
  // Offline: don't wait on a request that cannot succeed; the app runs from the device's copy
  if (!navigator.onLine) {
    if (state.error?.code !== 'offline') { state.error = { code: 'offline' }; emit(); }
    return Promise.resolve();
  }
  const started = epoch;
  syncPromise = (async () => {
    state.syncing = true;
    emit();
    let changed = false;
    try {
      while (state.queue.length) {
        const op = state.queue[0];
        try {
          const res = await callApi(state.config, op.action, op.payload);
          if (started !== epoch) return;
          if (res.data) state.data = res.data;
          changed = true;
        } catch (e) {
          if (e instanceof ApiError && (e.code === 'server_error' || e.code === 'bad_request' || e.code === 'unknown_action')) {
            state.failedOps.push({ ...op, error: e.message });
          } else {
            throw e;
          }
        }
        state.queue.shift();
        changed = true;
        await persist(started);
      }
      const res = await callApi(state.config, 'read');
      if (started !== epoch) return;
      if (!sameTrip(state.data, res.data)) {
        if (!state.data || apply || changed) { state.data = res.data; state.pendingData = null; changed = true; }
        else state.pendingData = res.data;
      } else state.pendingData = null;
      if (res.me && JSON.stringify(res.me) !== JSON.stringify(state.config.me)) setConfig({ me: res.me });
      state.lastSynced = Date.now();
      state.error = null;
      await persist(started);
    } catch (e) {
      if (started !== epoch) return;
      if (e.code === 'bad_session') {
        // This device's sign-in no longer works: access removed, PIN reset, or idle too long.
        // Don't keep a copy of the trip on a device that is no longer signed in.
        const hadData = !!state.data;
        await eraseThisDevice({ keepUrl: true });
        state.error = { code: hadData ? 'revoked' : 'bad_session' };
      } else {
        state.error = { code: e.code || 'error', message: e.message };
      }
    } finally {
      state.syncing = false;
      syncPromise = null;
      if (changed || !state.data) rebuild(); // unchanged data: keep the same model, so views don't redraw
      emit();
      refreshWeatherNow(); // fetches only what is missing or stale
    }
  })();
  return syncPromise;
}

/** Queues an edit, shows it right away, and tries to send it. */
export async function enqueue(action, payload) {
  state.queue.push({ opId: `op-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, action, payload, at: Date.now() });
  await persist();
  rebuild();
  emit();
  sync();
}

export function dismissFailed() {
  state.failedOps = [];
  emit();
}

/** The Sheet data with queued (not yet sent) edits applied, so the app shows them immediately. */
export function applyQueue(data, queue) {
  if (!queue.length) return data;
  const d = structuredClone(data);
  const KEYS = { People: 'Name', Groups: 'Group' };
  const upsert = (tab, key, values) => {
    const t = d.tabs[tab] || (d.tabs[tab] = { headers: Object.keys(values), rows: [] });
    const k = KEYS[tab] || 'ID';
    const look = key || values[k];
    const row = look ? t.rows.find((r) => String(r[k]) === String(look)) : null;
    if (row) Object.assign(row, values, { _pending: true });
    else t.rows.push({ ...values, _row: `new`, _pending: true });
  };
  queue.forEach(({ action, payload }) => {
    if (action === 'upsert') upsert(payload.tab, payload.key, payload.values);
    if (action === 'moveIdea') {
      const idea = d.tabs.Ideas?.rows.find((r) => r.ID === payload.ideaId) || {};
      upsert('Reservations', null, { Type: idea.Type || 'Restaurant', Name: idea.Name, City: idea.City, Address: idea.Address, 'Kid-friendly': idea['Kid-friendly'], Link: /^https?:\/\//.test(idea.Source || '') ? idea.Source : '', Status: 'Tentative', Lat: idea.Lat, Lng: idea.Lng, ...payload.reservation });
      upsert('Ideas', payload.ideaId, { Status: 'Confirmed' });
    }
    if (action === 'addListValue') {
      d.lists.columns[payload.column] ||= [];
      if (!d.lists.columns[payload.column].some((v) => String(v).toLowerCase() === String(payload.value).toLowerCase())) {
        d.lists.columns[payload.column].push(payload.value);
        if (payload.column === 'City') d.lists.cities.push({ name: payload.value, lat: payload.extra?.['City Lat'] ?? null, lng: payload.extra?.['City Lng'] ?? null });
      }
    }
  });
  return d;
}

let wxTimer = null;
export function refreshWeatherNow() {
  clearTimeout(wxTimer);
  wxTimer = setTimeout(async () => {
    const m = state.model;
    if (!m.range || !navigator.onLine) return;
    const started = epoch;
    // Weather is shown per city the family is in, so fetch it for every city that appears on a stay or trip.
    const locs = [];
    m.items.forEach((it) => {
      if (it.status === 'Cancelled' || (it.type !== 'stay' && it.type !== 'transport')) return;
      it.cities.forEach((c) => { const loc = weatherLoc(m, c, it); if (loc) locs.push(loc); });
    });
    await refreshWeather(state.weather, locs, m.range, {
      fetchJson: (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
    });
    if (started !== epoch || !state.weather.fetched) return; // nothing new: no redraw
    state.weatherVersion = (state.weatherVersion || 0) + 1;
    set('weather', state.weather).catch(() => {});
    emit();
  }, 50);
}

/** Signs in with email + PIN; on success this device keeps a session token, never the PIN. */
export async function signIn(url, email, pin) {
  const res = await callApi({ url }, 'login', { email, pin, device: deviceLabel() });
  setConfig({ url, token: res.token, me: res.me });
  state.error = null;
  const read = await callApi(state.config, 'read');
  adoptData(read.data);
  return res.me;
}

/** Ends this device's session on the server (when online), then erases the device. */
export async function signOut() {
  try { if (navigator.onLine && state.config.token) await callApi(state.config, 'logout', {}, { timeoutMs: 8000 }); } catch { /* erase anyway */ }
  await eraseThisDevice();
}

export async function changePin(currentPin, newPin) {
  const res = await callApi(state.config, 'changePin', { currentPin, newPin });
  setConfig({ me: res.me });
  return res.me;
}

/** Administrator actions; each returns the updated list of people with access. */
/** Administrator: the trip's first and last day (empty strings = use the Sheet's dates). */
export async function setTripDates(start, end) {
  const res = await callApi(state.config, 'adminSetTripDates', { start, end });
  adoptData(res.data);
}

export async function admin(action, payload = {}) {
  const res = await callApi(state.config, action, payload);
  return res.users;
}

/**
 * Removes everything the app stored on this device: the trip data, unsent
 * changes, weather, filters, the sign-in and saved map tiles. The app
 * files themselves stay cached (they contain no trip data).
 */
export async function eraseThisDevice({ keepUrl = false } = {}) {
  epoch++;
  clearTimeout(wxTimer);
  const url = state.config.url;
  ['trip.config.v1', 'trip.filters.v1', 'trip.dayMode', 'trip.dayMode2', BACKUP_KEY].forEach((k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
  try { await clearIdb(); } catch { /* ignore */ }
  try { if ('caches' in window) await caches.delete('map-tiles'); } catch { /* ignore */ }
  Object.assign(state, { config: keepUrl && url ? { url } : {}, filters: loadFilters(), data: null, pendingData: null, lastSynced: 0, queue: [], failedOps: [], weather: {}, date: null, dateAuto: true });
  if (keepUrl && url) saveConfig(state.config);
  rebuild();
  emit();
}

/** Sends pasted text and/or a file to be read by Claude (through the Sheet's script). */
export async function extractBooking(payload) {
  return callApi(state.config, 'extract', payload, { timeoutMs: 180000 });
}

export async function resolveLocation(text) {
  const res = await callApi(state.config, 'resolveLocation', { text });
  return res.location;
}

export function adoptData(data) {
  state.data = data;
  state.lastSynced = Date.now();
  state.error = null;
  persist();
  refreshWeatherNow();
  rebuild();
  emit();
}

/** Coordinates used for a city's weather: the Lists city, else the stay's own location. */
export function weatherLoc(model, city, stay) {
  return model.cityCoord(city) || (stay?.type === 'stay' && stay.loc && stay.city === city ? stay.loc : null);
}
