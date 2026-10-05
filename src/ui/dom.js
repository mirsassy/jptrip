// Tiny DOM builder. Text from the Sheet is always inserted as text, never as HTML.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Inline SVG icon from a small fixed set (paths are constants, never user data). */
const ICONS = {
  stay: 'M3 20V9l9-5 9 5v11h-6v-6H9v6z',
  transport: 'M6 4h12a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3l1.5 2h-2.2L15 18H9l-1.3 2H5.5L7 18a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2zm0 3v4h12V7zm2 7.5a1.2 1.2 0 1 0 0 .01zm8 0a1.2 1.2 0 1 0 0 .01z',
  reservation: 'M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2zM5 9h14v10H5zm2 2v2h4v-2z',
  note: 'M5 3h10l4 4v14H5zm9 1v4h4M8 11h8M8 14h8M8 17h5',
  idea: 'M8 2v8a2 2 0 0 0 2 2v10h1V12a2 2 0 0 0 2-2V2h-1v7h-1V2h-1v7h-1V2zm8 0c-1.5 1-2.5 3.5-2.5 6.5V13H15v9h1z',
  checkout: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10',
  checkin: 'M10 4H5v16h5M14 8l4 4-4 4M18 12H8',
  staying: 'M3 20V9l9-5 9 5v11h-6v-6H9v6z',
  day: 'M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2zM5 9h14v10H5z',
  month: 'M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2zM5 9h4v3H5zm5 0h4v3h-4zm5 0h4v3h-4zM5 13h4v3H5zm5 0h4v3h-4zm5 0h4v3h-4z',
  map: 'M9 3 3 5.5v15L9 18l6 3 6-2.5v-15L15 6 9 3zm0 2.2 6 3v10.6l-6-3z',
  list: 'M4 6h2v2H4zm4 0h12v2H8zm-4 5h2v2H4zm4 0h12v2H8zm-4 5h2v2H4zm4 0h12v2H8z',
  issues: 'M12 2 1 21h22zm-1 7h2v6h-2zm0 8h2v2h-2z',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  plus: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z',
  gear: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.6 5.5 1.9 1.5-2 3.4-2.3-.9a8 8 0 0 1-2 1.2L15.8 21h-4l-.4-2.3a8 8 0 0 1-2-1.2l-2.3.9-2-3.4 1.9-1.5a8 8 0 0 1 0-2.4L5 9.6l2-3.4 2.3.9a8 8 0 0 1 2-1.2L11.8 3h4l.4 2.3a8 8 0 0 1 2 1.2l2.3-.9 2 3.4-1.9 1.5a8 8 0 0 1 0 2.4z',
  sync: 'M12 4a8 8 0 0 1 7.4 5H17v2h5V6h-2v1.6A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8zm8 8a8 8 0 0 1-15.4 3H7v-2H2v5h2v-1.6A10 10 0 0 0 22 12z',
  chevl: 'M15 5 8 12l7 7',
  chevr: 'M9 5l7 7-7 7',
  close: 'M6 6l12 12M18 6 6 18',
  edit: 'M4 17v3h3l11-11-3-3zM17 4l3 3',
  pin: 'M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  import: 'M12 3v11M7.5 9.5 12 14l4.5-4.5M4 15v5h16v-5',
  clip: 'M20 11.5 12 19.5a5 5 0 0 1-7-7L13.5 4a3.4 3.4 0 0 1 4.9 4.8L10 17.2a1.8 1.8 0 0 1-2.6-2.6L15 7',
  activity: 'M4 20l5-11 4 6 2-3 5 8zM15 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  kid: 'M12 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM7 10h10l-2 6v6h-2v-5h-2v5H9v-6z',
};
const STROKE = new Set(['import', 'clip', 'note', 'checkout', 'checkin', 'chevl', 'chevr', 'close', 'edit', 'ext']);

export function icon(name, size = 20) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICONS[name] || ICONS.pin);
  if (STROKE.has(name)) {
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
  } else {
    p.setAttribute('fill', 'currentColor');
  }
  svg.append(p);
  return svg;
}

export function toast(msg, ms = 3500) {
  const el = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ms);
}

/** Bottom sheet on phones, centered dialog on desktop. Returns { el, close }. */
export function sheet(title, body, { onClose } = {}) {
  const close = () => { wrap.classList.remove('open'); setTimeout(() => wrap.remove(), 200); document.removeEventListener('keydown', esc); onClose?.(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', null, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('close'))),
    h('div', { class: 'sheet-body' }, body));
  const wrap = h('div', { class: 'sheet-wrap', onclick: (e) => { if (e.target === wrap) close(); } }, panel);
  document.body.append(wrap);
  document.addEventListener('keydown', esc);
  requestAnimationFrame(() => wrap.classList.add('open'));
  return { el: panel, close };
}
