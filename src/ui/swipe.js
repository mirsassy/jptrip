// Sideways swipes on a view: left goes forward, right goes back (the Day view uses it to change
// day). Swipes that start on something that scrolls sideways (the strip of days), on a form field
// or on the map are left alone, and so are mostly-vertical moves (scrolling, pull to refresh).
const MIN_DX = 60;      // px the finger must travel sideways
const MAX_MS = 800;     // a slow drag is not a swipe
const RATIO = 1.6;      // sideways must clearly beat up/down

function scrollsSideways(el, root) {
  for (let n = el; n && n !== root; n = n.parentElement) {
    if (n.matches?.('input, select, textarea, .maplibregl-map, [data-no-swipe]')) return true;
    if (n.scrollWidth > n.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
  }
  return false;
}

export function onSwipe(root, { enabled, onLeft, onRight }) {
  let start = null;
  root.addEventListener('touchstart', (e) => {
    start = null;
    if (e.touches.length !== 1 || !enabled() || scrollsSideways(e.target, root)) return;
    const t = e.touches[0];
    start = { x: t.clientX, y: t.clientY, at: Date.now() };
  }, { passive: true });
  root.addEventListener('touchend', (e) => {
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x, dy = t.clientY - start.y;
    const quick = Date.now() - start.at <= MAX_MS;
    start = null;
    if (!quick || Math.abs(dx) < MIN_DX || Math.abs(dx) < RATIO * Math.abs(dy)) return;
    if (dx < 0) onLeft(); else onRight();
  });
  root.addEventListener('touchcancel', () => { start = null; });
}
