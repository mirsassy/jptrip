import './styles.css';
import { applyTheme } from './lib/theme.js';

applyTheme();
import { h, icon, clear, toast, sheet } from './ui/dom.js';
import { state, subscribe, init, sync, setConfig } from './lib/store.js';
import { findConflicts } from './lib/conflicts.js';
import { activeFilterCount } from './lib/filters.js';
import { ago, fmtJstStamp } from './lib/dates.js';
import { ERROR_TEXT } from './lib/api.js';
import { renderDay } from './ui/day.js';
import { renderMonth } from './ui/month.js';
import { renderList, renderIdeas, renderIssues, renderSettings, openFilters } from './ui/views.js';
import { openAddMenu } from './ui/forms.js';

const VIEWS = [
  ['day', 'Day', 'day'],
  ['month', 'Month', 'month'],
  ['list', 'List', 'list'],
  ['ideas', 'Ideas', 'idea'],
  ['issues', 'Issues', 'issues'],
];

const app = document.getElementById('app');
const syncPill = h('button', { class: 'sync-pill', 'aria-live': 'polite', onclick: () => sync() });
const filterBtn = h('button', { class: 'icon-btn', 'aria-label': 'Filters', onclick: openFilters }, icon('filter'));
const topNav = h('nav', { class: 'top-nav', 'aria-label': 'Views' });
const bottomNav = h('nav', { class: 'bottom', 'aria-label': 'Views' });
const title = h('h1', null, 'Japan trip');
const header = h('header', { class: 'top' }, title, topNav, h('div', { class: 'spacer' }), syncPill, filterBtn,
  h('button', { class: 'icon-btn', 'aria-label': 'Settings', onclick: () => toggleSettings() }, icon('gear')));
let lastView = 'day';
const paneMain = h('section', { class: 'pane pane-main', 'aria-live': 'off' });
const paneMap = h('section', { class: 'pane pane-map' });
const fab = h('button', { class: 'fab', 'aria-label': 'Add to the trip', onclick: openAddMenu }, icon('plus', 26));
app.append(header, h('main', null, paneMain, paneMap), bottomNav);
// Floating Map button: opens the whole-trip map; tapped again on the map, it goes back
const mapFab = h('button', { class: 'fab fab-map', 'aria-label': 'Trip map', onclick: () => {
  if (route() === 'map') { location.hash = `#${lastView}`; return; }
  location.hash = '#map';
} }, icon('map', 24));
document.body.append(fab, mapFab);

let conflicts = [];
let conflictsFor = -1;
let lastPaneKey = '';

/* Settings open in a dialog over the current view; the gear (or #settings link) toggles it. */
let settingsDlg = null;
function toggleSettings() {
  if (settingsDlg) { settingsDlg.close(); return; }
  if (needsSetup()) return;
  const body = h('div');
  const draw = () => {
    if (body.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    renderSettings(body, { inDialog: true });
  };
  draw();
  const unsub = subscribe(draw);
  settingsDlg = sheet('Settings', body, { onClose: () => { unsub(); settingsDlg = null; } });
  settingsDlg.el.classList.add('wide');
}
let mapModule = null;
const isDesktop = () => matchMedia('(min-width: 1000px)').matches;

function route() {
  const hash = location.hash.replace(/^#/, '');
  if (hash.startsWith('setup=')) {
    const url = decodeURIComponent(hash.slice(6));
    if (/^https:\/\/script\.google(usercontent)?\.com\//.test(url) || /^http:\/\/localhost/.test(url)) setConfig({ url });
    history.replaceState(null, '', location.pathname + location.search + '#day');
    return 'setup';
  }
  if (hash === 'settings') {
    history.replaceState(null, '', `${location.pathname}${location.search}#${lastView}`);
    if (!needsSetup()) setTimeout(() => { if (!settingsDlg) toggleSettings(); });
    return lastView;
  }
  const known = ['day', 'month', 'map', 'list', 'ideas', 'issues'];
  return known.includes(hash) ? hash : 'day';
}

function needsSetup() {
  return !state.config.url || !state.config.token;
}

function renderChrome(view) {
  const issueCount = conflicts.filter((c) => c.severity !== 'info').length + state.failedOps.length;
  const links = (cls) => VIEWS.map(([id, label, ic]) => h('a', { href: `#${id}`, 'aria-current': view === id ? 'page' : null, class: cls },
    icon(ic, 22), h('span', null, label), id === 'issues' && issueCount ? h('span', { class: 'badge', 'aria-label': `${issueCount} issues` }, String(issueCount)) : null));
  clear(topNav).append(...links());
  clear(bottomNav).append(...links());

  if (state.model.range) title.textContent = `Japan ${state.model.range.start.slice(0, 4)}`;

  const n = activeFilterCount(state.filters);
  filterBtn.querySelector('.badge')?.remove();
  if (n) filterBtn.append(h('span', { class: 'badge' }, String(n)));
  filterBtn.setAttribute('aria-label', n ? `Filters (${n} on)` : 'Filters');

  const q = state.queue.length;
  let cls = '', text;
  if (state.syncing) { cls = 'syncing'; text = q ? `Sending ${q} change(s)…` : 'Syncing…'; }
  else if (!state.online || state.error?.code === 'offline') { cls = 'offline'; text = `Offline · synced ${ago(state.lastSynced)}${q ? ` · ${q} waiting` : ''}`; }
  else if (state.error) { cls = 'error'; text = 'Sync problem'; }
  else text = `Synced ${ago(state.lastSynced)}${q ? ` · ${q} waiting` : ''}`;
  syncPill.className = `sync-pill ${cls}`;
  clear(syncPill).append(h('span', { class: 'dot' }), text);
  syncPill.title = `Last synced ${fmtJstStamp(state.lastSynced)}. Tap to sync now.`;
}

function render() {
  let view = route();
  if (view === 'setup' || needsSetup()) view = 'setup';
  if (view === 'setup' && settingsDlg) settingsDlg.close();
  document.body.dataset.view = view;
  if (VIEWS.some(([id]) => id === view)) lastView = view;
  // Issue checks run once per change of the trip data, not on every redraw
  if (conflictsFor !== state.modelVersion) { conflicts = findConflicts(state.model); conflictsFor = state.modelVersion; }
  renderChrome(view);
  fab.classList.toggle('hidden', view === 'setup' || (view === 'map' && !isDesktop()) || needsSetup());
  mapFab.classList.toggle('hidden', !(view === 'month' || view === 'map') || needsSetup()); // the trip map opens from the Month view
  mapFab.setAttribute('aria-pressed', String(view === 'map'));
  mapFab.setAttribute('aria-label', view === 'map' ? 'Close the map' : 'Trip map');
  mapFab.replaceChildren(icon(view === 'map' ? 'close' : 'map', 24));

  // Don't redraw a form someone is typing in, nor a view whose content has not changed
  // (a sync starting or ending, or the online state, only changes the top bar)
  const paneKey = [view, state.modelVersion, state.date, JSON.stringify(state.filters), state.weatherVersion, state.failedOps.length, state.error?.code || '', isDesktop(), state.config.me?.role || ''].join('|');
  const typingNow = paneMain.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  const typing = typingNow || paneKey === lastPaneKey;
  if (!typingNow) lastPaneKey = paneKey; // a redraw held back while typing still happens afterwards
  const errorBanner = state.error && !['offline', 'revoked', 'bad_session'].includes(state.error.code) ? h('div', { class: 'banner error', role: 'alert' }, h('div', null, ERROR_TEXT[state.error.code] || state.error.message || 'Sync failed.', ' ', h('button', { class: 'link', onclick: () => toggleSettings() }, 'Settings'))) : null;

  if (view === 'setup') {
    if (!typing) {
      renderSettings(paneMain, { firstRun: true });
      if (state.error?.code === 'revoked' || state.error?.code === 'bad_session') paneMain.prepend(h('div', { class: 'banner error', role: 'alert' }, ERROR_TEXT[state.error.code]));
    }
  } else if (view !== 'map' || isDesktop()) {
    const target = view === 'map' ? 'day' : view;
    if (!typing) {
      if (target === 'day') renderDay(paneMain, conflicts);
      if (target === 'month') renderMonth(paneMain);
      if (target === 'list') renderList(paneMain);
      if (target === 'ideas') renderIdeas(paneMain);
      if (target === 'issues') renderIssues(paneMain, conflicts);
      if (errorBanner) paneMain.prepend(errorBanner);
    }
  }

  // Clear the map whenever the app is signed out, so no old pins stay on screen
  if (view === 'setup' && mapModule) mapModule.updateMap();
  const mapVisible = view !== 'setup' && (view === 'map' || (isDesktop() && view !== 'month'));
  if (mapVisible) {
    if (!mapModule) {
      import('./ui/map.js').then((mod) => { mapModule = mod; mod.renderMap(paneMap, { wholeTrip: view === 'map' }); });
    } else {
      mapModule.renderMap(paneMap, { wholeTrip: view === 'map' });
    }
  }
}

let raf = 0;
subscribe(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); });
window.addEventListener('hashchange', render);
matchMedia('(min-width: 1000px)').addEventListener('change', render);

init().then(() => {
  render();
  sync();
  setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 5 * 60 * 1000);
  setInterval(() => renderChrome(route()), 60 * 1000); // keep "synced x min ago" fresh
});

// Service worker: offline app shell and viewed map tiles
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          // Front and centre: a dialog, not a banner that is easy to miss
          const dlg = sheet('New version available', h('div', null,
            h('p', null, 'An updated version of the trip app is ready. Reload to start using it; your trip data stays on this device.'),
            h('div', { class: 'form-actions' },
              h('button', { class: 'btn', onclick: () => dlg.close() }, 'Later'),
              h('button', { class: 'btn primary', onclick: () => { sw.postMessage('skipWaiting'); } }, 'Reload now'))));
          dlg.el.classList.add('center');
        }
      });
    });
  }).catch(() => toast('Offline mode is not available in this browser.'));
  // Reload only when an update replaces a running version (after "Reload" is tapped),
  // not when the service worker first takes control of a fresh page.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
}
