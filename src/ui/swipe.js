// Sideways swipes that follow the finger: the view slides with it, and on release either
// glides off to that side (the next day comes in from the other side) or springs back.
// Swipes that start on something that scrolls sideways (the strip of days), on a form field
// or on the map are left alone, and so are mostly-vertical moves (scrolling, pull to refresh).
const DECIDE_PX = 10;     // movement before telling a swipe from a scroll
const RATIO = 1.2;        // sideways must beat up/down by this much
const GO_FRACTION = 0.22; // of the width: release past this to change day
const GO_SPEED = 0.45;    // px/ms: or a quick flick
const OUT_MS = 170;
const IN_MS = 220;

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

function scrollsSideways(el, root) {
  for (let n = el; n && n !== root; n = n.parentElement) {
    if (n.matches?.('input, select, textarea, .maplibregl-map, [data-no-swipe]')) return true;
    if (n.scrollWidth > n.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
  }
  return false;
}

/**
 * `canGo(dir)`: whether there is somewhere to go (+1 forward = swipe left, -1 back = swipe right).
 * `go(dir)`: changes the view; may return a promise. `blocked(dir)`: called on a full swipe with
 * nowhere to go.
 */
export function onSwipe(root, { enabled, canGo, go, blocked = () => {}, peek = () => '' }) {
  let s = null;      // the touch being followed
  let busy = false;  // an animation is running
  // What is coming: the next or previous day's name, shown in the space the view uncovers
  const hint = document.createElement('div');
  hint.className = 'swipe-hint';
  hint.setAttribute('aria-hidden', 'true');
  document.body.append(hint);
  const showHint = (dx) => {
    const dir = dx < 0 ? 1 : -1;
    const text = Math.abs(dx) > 8 && canGo(dir) ? peek(dir) : '';
    if (!text) { hint.style.opacity = '0'; return; }
    hint.textContent = dir > 0 ? `${text} ›` : `‹ ${text}`;
    // Rides just outside the moving day's edge, in the space it uncovers
    const r = root.getBoundingClientRect(); // already moved by dx
    const w = hint.offsetWidth;
    hint.style.top = `${r.top + Math.min((root.clientHeight || r.height) / 2, 240)}px`;
    hint.style.left = `${dir > 0 ? r.right + 12 : r.left - 12 - w}px`;
    hint.style.opacity = String(Math.min(1, (Math.abs(dx) - 8) / 60));
  };

  const set = (x, ms = 0, ease = 'ease-out') => {
    root.style.transition = ms ? `transform ${ms}ms ${ease}, opacity ${ms}ms ${ease}` : 'none';
    root.style.transform = x ? `translate3d(${x}px, 0, 0)` : '';
    root.style.opacity = x ? String(Math.max(0.55, 1 - Math.abs(x) / (root.clientWidth * 1.6))) : '';
  };
  const done = (ms) => new Promise((r) => setTimeout(r, ms + 30));

  root.addEventListener('touchstart', (e) => {
    s = null;
    if (!busy && root.style.transform) set(0); // never left part-way across
    if (busy || e.touches.length !== 1 || !enabled() || scrollsSideways(e.target, root)) return;
    const t = e.touches[0];
    s = { x: t.clientX, y: t.clientY, at: Date.now(), dragging: false, dx: 0, lastX: t.clientX, lastAt: Date.now(), v: 0 };
    follow(e.target);
  }, { passive: true });

  // The rest of a touch goes to the element it started on, even if a redraw has since taken
  // that element out of the page (its events then no longer reach root): so listen there.
  let target = null;
  const follow = (el) => {
    unfollow();
    target = el;
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', cancel);
  };
  const unfollow = () => {
    if (!target) return;
    target.removeEventListener('touchmove', move);
    target.removeEventListener('touchend', end);
    target.removeEventListener('touchcancel', cancel);
    target = null;
  };

  const move = (e) => {
    if (!s) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (!s.dragging) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < DECIDE_PX) return;
      if (Math.abs(dx) < RATIO * Math.abs(dy)) { s = null; return; } // a scroll or a pull, not a swipe
      s.dragging = true;
    }
    if (e.cancelable) e.preventDefault(); // the view follows the finger instead of scrolling
    const now = Date.now();
    s.v = (t.clientX - s.lastX) / Math.max(1, now - s.lastAt);
    s.lastX = t.clientX; s.lastAt = now;
    const dir = dx < 0 ? 1 : -1;
    s.dx = canGo(dir) ? dx : dx * 0.3; // at the first or last day it gives a little, then resists
    set(s.dx);
    showHint(s.dx);
  };

  const end = async () => {
    unfollow();
    if (!s) return;
    const { dragging, dx, v } = s;
    s = null;
    hint.style.opacity = '0';
    if (!dragging) return;
    const w = root.clientWidth;
    const dir = dx < 0 ? 1 : -1;
    const far = Math.abs(dx) > w * GO_FRACTION || (Math.abs(v) > GO_SPEED && Math.sign(v) === Math.sign(dx));
    if (!far || !canGo(dir)) {
      if (far) blocked(dir);
      set(0, 200);
      await done(200);
      set(0);
      return;
    }
    busy = true;
    try {
      if (reduced()) { await go(dir); return; }
      // Off it goes, the new day is drawn, then it comes in from the other side
      set(-dir * w, OUT_MS, 'ease-in');
      await done(OUT_MS);
      set(dir * w * 0.35);
      root.style.opacity = '0';
      await go(dir);
      await frame(); await frame(); // let the new day render
      set(0, IN_MS, 'cubic-bezier(.2,.8,.2,1)');
      await done(IN_MS);
    } finally {
      set(0);
      root.style.opacity = '';
      busy = false;
    }
  };
  function cancel() {
    unfollow();
    hint.style.opacity = '0';
    if (s?.dragging) { set(0, 200); setTimeout(() => set(0), 230); }
    s = null;
  }
}
