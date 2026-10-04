/* Service worker: keeps the app working offline.
 * - App files are cached at install (list injected at build time).
 * - Map tiles, fonts and sprites from OpenFreeMap are cached only when the map
 *   shows them (no bulk prefetching), capped at TILE_MAX entries, oldest first out.
 * - Sheet data and weather are stored by the app itself in IndexedDB.
 */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const SHELL = `shell-${VERSION}`;
const TILES = 'map-tiles';
const TILE_MAX = 4000;
const TILE_HOST = 'tiles.openfreemap.org';
// ignoreVary: servers send e.g. "Vary: Origin", and module scripts are requested with an
// Origin header that the install-time request lacked, which would otherwise miss the cache.
const MATCH = { ignoreSearch: true, ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      // App shell from the cache, so the app opens offline; new versions arrive via a new sw.js
      event.respondWith((async () => {
        const shell = (await caches.match(self.registration.scope, MATCH)) || (await caches.match(new URL('./index.html', self.registration.scope).href, MATCH));
        return shell || fetch(req);
      })());
      return;
    }
    event.respondWith(caches.match(req, MATCH).then((r) => r || fetch(req)));
    return;
  }

  if (url.hostname === TILE_HOST) {
    const isStyle = /\/styles\/|\.json$|\/planet$|\/planet\/?$/.test(url.pathname) && !/\.pbf$|\.png$/.test(url.pathname);
    event.respondWith(isStyle ? networkFirst(req) : cacheFirst(req));
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    trim(cache);
  }
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(TILES);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw e;
  }
}

let puts = 0;
async function trim(cache) {
  if (++puts % 50) return;
  const keys = await cache.keys();
  const extra = keys.length - TILE_MAX;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}
