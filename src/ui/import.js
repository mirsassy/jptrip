// "Import from a file or pasted text": the Sheet's script sends the text or file to
// Claude, which returns the bookings it found. Each one then opens in its add form,
// pre-filled, so the person checks it and picks who is going before it is saved.
import { h, icon, sheet, toast } from './dom.js';
import { state, extractBooking, fetchAttachment, discardUpload } from '../lib/store.js';
import { ERROR_TEXT } from '../lib/api.js';
import { importHints, toRow, rowSummary } from '../lib/importer.js';
import { openEditor, TAB_TITLES } from './forms.js';

const MAX_BYTES = 8 * 1024 * 1024;
const CLAUDE_IMAGES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const TEXT_EXT = /\.(ics|eml|txt|csv|html?|md|json|vcs)$/i;
const ICON = { Stays: 'stay', Transport: 'transport', Reservations: 'reservation', Notes: 'note' };

const isText = (f) => TEXT_EXT.test(f.name) || /^text\//.test(f.type) || f.type === 'message/rfc822';

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Photos are shrunk (longest side 2000 px) and HEIC etc. converted to JPEG: smaller uploads, same readability. */
async function prepareImage(file) {
  const ok = CLAUDE_IMAGES.includes(file.type);
  let bmp;
  try { bmp = await createImageBitmap(file); } catch {
    if (ok && file.size <= 3.5 * 1024 * 1024) return file;
    throw new Error('file_type');
  }
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  if (ok && scale === 1 && file.size <= 3.5 * 1024 * 1024) return file;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
  return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`, { type: 'image/jpeg' });
}

/** Builds the request: text files are read here and sent as text; PDFs and images go as files. */
async function buildPayload(text, file, keep) {
  const payload = { text, keep: !!(file && keep), hints: importHints(state.model) };
  if (!file) return payload;
  let f = file;
  if (isText(file)) {
    payload.text = `${text}${text ? '\n\n' : ''}--- ${file.name} ---\n${(await file.text()).slice(0, 100000)}`;
  } else if (file.type.startsWith('image/') || /\.(heic|heif)$/i.test(file.name)) {
    f = await prepareImage(file);
  } else if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    throw new Error('file_type');
  }
  if (f.size > MAX_BYTES) throw new Error('file_too_big');
  if (isText(file) && !keep) return payload;
  payload.file = { name: f.name, mimeType: isText(file) ? 'text/plain' : (f.type || 'application/pdf'), data: await toBase64(f) };
  return payload;
}

export function openImport() {
  const text = h('textarea', { name: 'import-text', rows: 6, placeholder: 'Paste a confirmation email, a booking page, or notes like “Dinner at Ichiran, Mar 6 7pm, 4 people”' });
  const fileInput = h('input', { type: 'file', accept: '.pdf,application/pdf,image/*,.heic,.ics,.eml,.txt,.csv,.html,.htm', class: 'hidden', 'aria-label': 'Choose a file' });
  const fileLine = h('div', { class: 'small', 'aria-live': 'polite' });
  const keep = h('input', { type: 'checkbox', name: 'keep', checked: true });
  const keepRow = h('label', { class: 'row small hidden', style: { marginTop: '8px', alignItems: 'flex-start', flexWrap: 'nowrap' } }, keep,
    h('span', null, 'Keep a copy of the file with the booking (stored privately in the trip organizer’s Google Drive; anyone signed in to the app can open it)'));
  let file = null;
  const showFile = () => {
    fileLine.replaceChildren(...(file ? [icon('clip', 16), ` ${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB) `, h('button', { type: 'button', class: 'link', onclick: () => { file = null; fileInput.value = ''; showFile(); } }, 'remove')] : []));
    keepRow.classList.toggle('hidden', !file);
  };
  fileInput.addEventListener('change', () => { file = fileInput.files[0] || null; showFile(); });

  const go = h('button', { type: 'submit', class: 'btn primary' }, 'Read it');
  const status = h('p', { class: 'small muted', 'aria-live': 'polite' });
  const offline = !navigator.onLine;
  if (offline) go.disabled = true;

  const form = h('form', null,
    h('p', { class: 'muted', style: { marginTop: 0 } }, 'Claude reads it and fills in the forms. You check each booking and choose who is going before anything is added.'),
    offline ? h('div', { class: 'banner warn' }, 'Importing needs internet. You can still add bookings by hand.') : null,
    h('label', { class: 'field' }, h('span', null, 'Paste text'), text),
    h('div', { class: 'field' }, h('span', null, 'Or a file'),
      h('div', null, h('button', { type: 'button', class: 'btn small', onclick: () => fileInput.click() }, icon('clip', 18), 'Choose a file or photo'), fileInput),
      h('div', { class: 'small muted', style: { marginTop: '4px' } }, 'PDF, photo or screenshot, calendar file (.ics) or saved email (.eml); up to 8 MB.'),
      fileLine, keepRow),
    h('p', { class: 'small muted' }, 'What you paste or upload is sent to Anthropic’s Claude to be read. Leave out card and passport numbers.'),
    status,
    h('div', { class: 'form-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => s.close() }, 'Close'), go));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!text.value.trim() && !file) { toast(ERROR_TEXT.nothing_to_read); text.focus(); return; }
    if (!navigator.onLine) { toast('Importing needs internet.'); return; }
    go.disabled = true;
    status.textContent = 'Reading… this can take up to a minute.';
    try {
      const payload = await buildPayload(text.value.trim(), file, keep.checked);
      const res = await extractBooking(payload);
      s.close();
      showResults(res);
    } catch (err) {
      const code = err.code || err.message;
      status.textContent = '';
      toast(ERROR_TEXT[code] ? `${ERROR_TEXT[code]}${code === 'ai_failed' && err.message && err.message !== code ? ` (${err.message})` : ''}` : 'Something went wrong. Try again.', 6000);
      go.disabled = false;
    }
  });
  const s = sheet('Import a booking', form);
  return s;
}

/** The list of bookings Claude found; each opens in its form, pre-filled. */
function showResults(res) {
  const rows = (res.items || []).map((it) => toRow(it, state.model, res.attachment || ''));
  let added = 0;
  const list = h('div', { style: { display: 'grid', gap: '10px' } });
  rows.forEach((r) => {
    const btn = h('button', { type: 'button', class: 'btn primary small' }, 'Check and add');
    const card = h('div', { class: 'card', dataset: { importTab: r.tab } },
      h('div', { class: 'row', style: { flexWrap: 'nowrap', alignItems: 'flex-start' } }, icon(ICON[r.tab] || 'note'),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { fontWeight: 600 } }, `${(TAB_TITLES[r.tab] || r.tab).replace(/^./, (c) => c.toUpperCase())}: ${rowSummary(r)}`),
          h('div', { class: 'small muted' }, r.values.Who ? `Who: ${r.values.Who}` : 'Who: not chosen yet'),
          r.unmatched.length ? h('div', { class: 'small muted' }, `Names in the booking not matched to People: ${r.unmatched.join(', ')}`) : null)),
      h('div', { style: { marginTop: '8px', textAlign: 'right' } }, btn));
    btn.addEventListener('click', () => {
      openEditor(r.tab, null, r.values, {
        intro: h('div', { class: 'banner info' }, h('div', null, 'Filled in by Claude from your document. Check the details', r.tab === 'Notes' ? '' : ' and who is going', ', then tap Add.')),
        onSaved: () => {
          added++;
          card.classList.add('done');
          btn.replaceWith(h('span', { class: 'small', style: { fontWeight: 600 } }, '✓ Added'));
        },
      });
    });
    list.append(card);
  });

  const body = h('div', null,
    (res.warnings || []).length ? h('div', { class: 'banner warn', role: 'note' }, h('div', null, h('strong', null, 'Double-check: '), res.warnings.join(' '))) : null,
    rows.length
      ? h('p', { class: 'muted', style: { marginTop: 0 } }, `Found ${rows.length} booking${rows.length === 1 ? '' : 's'}. Nothing is added until you tap Add in each form.`)
      : h('p', null, 'No bookings were found in that. You can add one by hand with the + button.'),
    list,
    res.attachment ? h('p', { class: 'small muted' }, icon('clip', 14), ' The file is kept with each booking you add from here.') : null,
    h('div', { class: 'form-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => s.close() }, 'Done')));
  const s = sheet('Bookings found', body, {
    // A kept file that ended up on no booking is moved to the Drive trash
    onClose: () => { if (res.attachment && !added) discardUpload(res.attachment); },
  });
}

/** Shows a file kept with a booking: fetched through the app, since it lives in the organizer's private Drive. */
export async function openAttachment(link) {
  if (!navigator.onLine) { toast('Opening the file needs internet.'); return; }
  const body = h('div', null, h('p', { class: 'muted' }, 'Loading the file…'));
  let url = null;
  const s = sheet('Uploaded file', body, { onClose: () => { if (url) setTimeout(() => URL.revokeObjectURL(url), 60000); } });
  try {
    const f = await fetchAttachment(link);
    const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
    url = URL.createObjectURL(new Blob([bytes], { type: f.mimeType || 'application/octet-stream' }));
    body.replaceChildren(
      h('p', { class: 'small muted' }, f.name),
      /^image\//.test(f.mimeType) ? h('img', { src: url, alt: f.name, style: { maxWidth: '100%', borderRadius: '8px' } }) : null,
      h('p', null, h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener', download: f.name }, icon('ext', 18), 'Open or save the file')));
  } catch (err) {
    body.replaceChildren(h('p', null, ERROR_TEXT[err.code] || 'The file could not be opened.'));
  }
  return s;
}
