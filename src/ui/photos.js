// Photos on reservations: the cover thumbnail shown in lists, the gallery in a reservation's
// view (add, pin as cover, remove), and the full-size viewer.
import { h, icon, sheet, toast } from './dom.js';
import { state, enqueue } from '../lib/store.js';
import { ERROR_TEXT } from '../lib/api.js';
import { getThumb, getPhoto, addPhotos, deletePhoto } from '../lib/photos.js';
import { fmtShort } from '../lib/dates.js';

/** A square preview that fills in once the picture arrives (from the device, else the Sheet). */
function thumbImg(id, alt) {
  const img = h('img', { class: 'thumb-img', alt, decoding: 'async' });
  getThumb(id, (url) => { img.src = url; });
  return img;
}

/** The reservation's pinned photo as a small tappable thumbnail, or nothing if it has none. */
export function coverThumb(it, onclick) {
  if (!it.cover) return null;
  return h('button', { type: 'button', class: 'cover-thumb', 'aria-label': `Photos of ${it.title} (${it.photos.length})`, onclick: (e) => { e.stopPropagation(); onclick(); } },
    thumbImg(it.cover, ''), it.photos.length > 1 ? h('span', { class: 'cover-count' }, String(it.photos.length)) : null);
}

const errorText = (err) => ERROR_TEXT[err.code || err.message] || 'Something went wrong. Try again.';

/** The gallery inside a reservation's view. Redraws itself after each change. */
export function photoSection(id) {
  const box = h('section', { class: 'photos', 'aria-label': 'Photos' });
  const draw = () => {
    const it = state.model.itemById.get(id);
    if (!it) { box.replaceChildren(); return; }
    const input = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'hidden', 'aria-label': 'Choose photos' });
    const status = h('span', { class: 'small muted', 'aria-live': 'polite' });
    const add = h('button', { type: 'button', class: 'btn small', onclick: () => {
      if (!navigator.onLine) { toast('Adding photos needs internet.'); return; }
      input.click();
    } }, icon('camera', 16), 'Add photos');
    input.addEventListener('change', async () => {
      const files = [...input.files];
      if (!files.length) return;
      add.disabled = true;
      try {
        await addPhotos(id, files, (done, n) => { status.textContent = n > 1 ? `Adding ${Math.min(done + 1, n)} of ${n}…` : 'Adding…'; });
        draw();
      } catch (err) {
        status.textContent = '';
        add.disabled = false;
        toast(errorText(err), 6000);
      }
    });
    box.replaceChildren(
      h('div', { class: 'row', style: { justifyContent: 'space-between', margin: '12px 0 8px' } },
        h('h3', { style: { margin: 0 } }, 'Photos', it.photos.length ? h('span', { class: 'muted small' }, ` (${it.photos.length})`) : null),
        h('span', { class: 'row' }, status, add, input)),
      it.photos.length
        ? h('div', { class: 'photo-grid' }, it.photos.map((p) => h('button', { type: 'button', class: `photo-cell${p.id === it.cover ? ' is-cover' : ''}`,
          'aria-label': `Photo added by ${p.by}${p.id === it.cover ? ' (pinned)' : ''}`, onclick: () => openPhoto(id, p.id, draw) },
          thumbImg(p.id, ''), p.id === it.cover ? h('span', { class: 'cover-star', title: 'Pinned' }, icon('star', 14)) : null)))
        : h('p', { class: 'small muted', style: { margin: 0 } }, 'No photos yet. The first one added is shown with this booking; you can pin a different one.'));
  };
  draw();
  return box;
}

/** One photo, full size: pin it as the cover, or remove it (the person who added it, or the administrator). */
function openPhoto(itemId, photoId, onChange) {
  const it = state.model.itemById.get(itemId);
  const p = it?.photos.find((x) => x.id === photoId);
  if (!p) return;
  const me = state.config.me || {};
  const img = h('img', { class: 'photo-full', alt: `Photo of ${it.title}` });
  const loading = h('p', { class: 'muted small' }, 'Loading…');
  getPhoto(p.id).then((url) => { img.src = url; loading.remove(); })
    .catch((err) => { loading.textContent = navigator.onLine ? errorText(err) : 'This photo has not been opened on this device yet; it needs internet the first time.'; });
  const isCover = p.id === it.cover;
  const body = h('div', null, loading, img,
    h('p', { class: 'small muted' }, `Added by ${p.by}${p.at ? ` · ${fmtShort(String(p.at).slice(0, 10))}` : ''}`),
    h('div', { class: 'form-actions' },
      p.by === me.name || me.role === 'admin' ? h('button', { type: 'button', class: 'btn', style: { marginRight: 'auto' }, onclick: async () => {
        if (!confirm('Remove this photo for everyone?')) return;
        if (!navigator.onLine) { toast('Removing photos needs internet.'); return; }
        try { await deletePhoto(p.id); s.close(); onChange(); } catch (err) { toast(errorText(err), 6000); }
      } }, icon('trash', 16), 'Remove') : null,
      isCover ? h('span', { class: 'small muted' }, icon('star', 14), ' Pinned') : h('button', { type: 'button', class: 'btn primary', onclick: async () => {
        await enqueue('upsert', { tab: 'Reservations', key: it.id, values: { 'Pinned photo': p.id } });
        s.close();
        onChange();
      } }, icon('star', 16), 'Pin to show with the booking')));
  const s = sheet(it.title, body);
  s.el.classList.add('wide');
}
