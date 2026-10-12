// Photos on reservations. The app shrinks each photo before sending it (the Sheet stores it
// as text in its Photos tab); small square previews are kept on the device so lists show
// them offline. Full-size photos are fetched when opened, and kept once seen.
import { get, set } from 'idb-keyval';
import { state, adoptData } from './store.js';
import { callApi } from './api.js';

const FULL_SIDE = 1600;
const FULL_MAX_CHARS = 45000 * 8;   // what the script accepts (8 cells)
const THUMB_SIDE = 240;
const THUMB_MAX_CHARS = 40000;

async function load(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {
    // Some browsers can't decode HEIC etc. through createImageBitmap; try an <img>
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } catch { throw new Error('photo_type'); } finally { URL.revokeObjectURL(url); }
  }
}

function draw(img, w, h, sx = 0, sy = 0, sw = img.width, sh = img.height) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  return c;
}

/** JPEG data URL no longer than `max` characters: lowers quality, then size, until it fits. */
function fit(img, side, max, square = false) {
  let s = side;
  for (let tries = 0; tries < 8; tries++) {
    let c;
    if (square) {
      const e = Math.min(img.width, img.height);
      c = draw(img, s, s, (img.width - e) / 2, (img.height - e) / 2, e, e);
    } else {
      const k = Math.min(1, s / Math.max(img.width, img.height));
      c = draw(img, Math.round(img.width * k), Math.round(img.height * k));
    }
    for (const q of [0.82, 0.7, 0.58]) {
      const url = c.toDataURL('image/jpeg', q);
      if (url.length <= max) return url;
    }
    s = Math.round(s * 0.75);
  }
  throw new Error('photo_too_big');
}

export async function preparePhoto(file) {
  const img = await load(file);
  return { image: fit(img, FULL_SIDE, FULL_MAX_CHARS), thumb: fit(img, THUMB_SIDE, THUMB_MAX_CHARS, true) };
}

/** Adds photos to a reservation, one at a time (each is a separate request). */
export async function addPhotos(reservationId, files, onProgress = () => {}) {
  let done = 0;
  for (const f of files) {
    onProgress(done, files.length);
    const { image, thumb } = await preparePhoto(f);
    const res = await callApi(state.config, 'addPhoto', { for: reservationId, image, thumb }, { timeoutMs: 120000 });
    thumbs.set(res.id, thumb);
    set(`thumb:${res.id}`, thumb).catch(() => {});
    adoptData(res.data);
    done++;
  }
  onProgress(done, files.length);
}

export async function deletePhoto(id) {
  const res = await callApi(state.config, 'deletePhoto', { id });
  adoptData(res.data);
}

/* Previews: memory, then the device, then the Sheet (asked for in batches). */
const thumbs = new Map();
const waiting = new Map(); // id -> [callbacks]
let batchTimer = 0;

export function getThumb(id, cb) {
  if (thumbs.has(id)) { cb(thumbs.get(id)); return; }
  if (!waiting.has(id)) waiting.set(id, []);
  waiting.get(id).push(cb);
  clearTimeout(batchTimer);
  batchTimer = setTimeout(fetchWaiting, 30);
}

async function fetchWaiting() {
  const ids = [...waiting.keys()];
  const deliver = (id, url) => { thumbs.set(id, url); (waiting.get(id) || []).forEach((cb) => cb(url)); waiting.delete(id); };
  const missing = [];
  await Promise.all(ids.map(async (id) => {
    const url = await get(`thumb:${id}`).catch(() => null);
    if (url) deliver(id, url); else missing.push(id);
  }));
  if (!missing.length || !navigator.onLine || !state.config.token) return;
  try {
    for (let i = 0; i < missing.length; i += 40) {
      const res = await callApi(state.config, 'photoThumbs', { ids: missing.slice(i, i + 40) });
      Object.entries(res.thumbs || {}).forEach(([id, url]) => {
        if (!/^data:image\/jpeg;base64,/.test(url)) return;
        set(`thumb:${id}`, url).catch(() => {});
        deliver(id, url);
      });
    }
  } catch { /* offline or not reachable: placeholders stay; tried again next time they are shown */ }
  missing.forEach((id) => waiting.delete(id));
}

export async function getPhoto(id) {
  const kept = await get(`photo:${id}`).catch(() => null);
  if (kept) return kept;
  const res = await callApi(state.config, 'photo', { id }, { timeoutMs: 60000 });
  if (!/^data:image\/jpeg;base64,/.test(res.image)) throw new Error('photo_bad');
  set(`photo:${id}`, res.image).catch(() => {});
  return res.image;
}
