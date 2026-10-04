import './styles.css';
import { h, icon, clear, toast } from './ui/dom.js';
import { state, subscribe, init, sync, setConfig } from './lib/store.js';
import { findConflicts } from './lib/conflicts.js';
import { activeFilterCount } from './lib/filters.js';
import { ago, fmtJstStamp } from './lib/dates.js';
import { ERROR_TEXT } from './lib/api.js';
import { renderDay } from './ui/day.js';
import { renderList, renderIdeas, renderIssues, renderSettings, openFilters } from './ui/views.js';
import { openAddMenu } from './ui/forms.js';

const VIEWS = [
  ['day', 'Day', 'day'],
  ['map', 'Map', 'map'],
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
  h('a', { class: 'icon-btn', href: '#settings', 'aria-label': 'Settings' }, icon('gear')));
const paneMain = h('section', { class: 'pane pane-main', 'aria-live': 'off' });
const paneMap = h('section', { class: 'pane pane-map' });
const fab = h('button', { class: 'fab', 'aria-label': 'Add to the trip', onclick: openAddMenu }, icon('plus', 26));
app.append(header, h('main', null, paneMain, paneMap), bottomNav);
document.body.append(fab);

let conflicts = [];
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
  const known = ['day', 'map', 'list', 'ideas', 'issues', 'settings'];
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
  if (view === 'setup' || (needsSetup() && view !== 'settings')) view = 'setup';
  document.body.dataset.view = view;
  conflicts = findConflicts(state.model);
  renderChrome(view);
  fab.classList.toggle('hidden', view === 'setup' || view === 'settings' || (view === 'map' && !isDesktop()) || needsSetup());

  // Don't redraw a form someone is typing in
  const typing = paneMain.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  const errorBanner = state.error && !['offline', 'revoked', 'bad_session'].includes(state.error.code) ? h('div', { class: 'banner error', role: 'alert' }, h('div', null, ERROR_TEXT[state.error.code] || state.error.message || 'Sync failed.', ' ', h('a', { href: '#settings' }, 'Settings'))) : null;

  if (view === 'setup') {
    if (!typing) {
      renderSettings(paneMain, { firstRun: true });
      if (state.error?.code === 'revoked' || state.error?.code === 'bad_session') paneMain.prepend(h('div', { class: 'banner error', role: 'alert' }, ERROR_TEXT[state.error.code]));
    }
  } else if (view === 'settings') {
    if (!typing) renderSettings(paneMain);
  } else if (view !== 'map' || isDesktop()) {
    const target = view === 'map' ? 'day' : view;
    if (!typing) {
      if (target === 'day') renderDay(paneMain, conflicts);
      if (target === 'list') renderList(paneMain);
      if (target === 'ideas') renderIdeas(paneMain);
      if (target === 'issues') renderIssues(paneMain, conflicts);
      if (errorBanner) paneMain.prepend(errorBanner);
    }
  }

  // Clear the map whenever the app is signed out, so no old pins stay on screen
  if (view === 'setup' && mapModule) mapModule.updateMap();
  const mapVisible = view !== 'setup' && (view === 'map' || isDesktop());
  if (mapVisible) {
    if (!mapModule) {
      import('./ui/map.js').then((mod) => { mapModule = mod; mod.renderMap(paneMap); });
    } else {
      mapModule.renderMap(paneMap);
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
          const bar = h('div', { class: 'banner info', style: { position: 'fixed', left: '12px', right: '12px', top: 'calc(env(safe-area-inset-top) + 64px)', zIndex: 60, boxShadow: 'var(--shadow)' } },
            h('div', null, 'A new version of the app is ready. ', h('button', { class: 'link', onclick: () => { sw.postMessage('skipWaiting'); } }, 'Reload')));
          document.body.append(bar);
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
