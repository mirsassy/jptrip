// Pull down from the top of a view to refresh (phones and tablets): a small indicator follows
// the finger; letting go past the threshold runs `onRefresh` (check for a new app version, then sync).
import { h, icon } from './dom.js';

const THRESHOLD = 70; // px of pull (after resistance) that triggers a refresh
const MAX = 110;
const DECIDE_PX = 10;   // movement before telling a pull from a scroll or a sideways swipe

export function pullToRefresh(scroller, onRefresh) {
  const label = h('span', null, 'Pull to refresh');
  const ind = h('div', { class: 'pull-ind', 'aria-hidden': 'true' }, icon('sync', 16), label);
  document.body.append(ind);
  let startY = null;
  let startX = 0;
  let dist = 0;
  let busy = false;

  const show = (d) => {
    ind.style.transform = `translate(-50%, ${Math.min(d, MAX) - 48}px)`;
    ind.style.opacity = String(Math.min(1, d / THRESHOLD));
    ind.classList.toggle('ready', d >= THRESHOLD);
  };
  const reset = () => { startY = null; dist = 0; ind.classList.remove('pulling'); show(0); };

  scroller.addEventListener('touchstart', (e) => {
    if (busy || e.touches.length !== 1 || scroller.scrollTop > 0) return;
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    dist = 0;
  }, { passive: true });

  scroller.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    const dy = e.touches[0].clientY - startY;
    const dx = Math.abs(e.touches[0].clientX - startX);
    if (!dist) {
      // A real finger wobbles: decide only once it has moved a little, then by its overall direction
      if (Math.max(dx, Math.abs(dy)) < DECIDE_PX) return;
      if (dy <= 0 || dx > dy || scroller.scrollTop > 0) { startY = null; return; } // scrolling up, or a sideways swipe
    } else if (dy <= 0 || scroller.scrollTop > 0) { reset(); return; }
    dist = dy * 0.5; // resistance, so it feels like a pull
    ind.classList.add('pulling');
    label.textContent = dist >= THRESHOLD ? 'Release to refresh' : 'Pull to refresh';
    show(dist);
    if (e.cancelable) e.preventDefault(); // keep the page from bouncing while pulling
  }, { passive: false });

  const end = async () => {
    if (startY === null) return;
    const go = dist >= THRESHOLD;
    startY = null;
    ind.classList.remove('pulling');
    if (!go) { reset(); return; }
    busy = true;
    ind.classList.add('busy');
    show(THRESHOLD);
    try {
      await onRefresh((text) => { label.textContent = text; });
    } finally {
      busy = false;
      ind.classList.remove('busy', 'ready');
      reset();
    }
  };
  scroller.addEventListener('touchend', end);
  scroller.addEventListener('touchcancel', reset);
}
