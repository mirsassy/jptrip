import { h, icon } from './dom.js';
import { state, weatherLoc } from '../lib/store.js';
import { weatherFor } from '../lib/weather.js';

export function personChip(name) {
  const p = state.model.peopleByName.get(name);
  return h('span', { class: 'chip' }, h('span', { class: 'sw', style: { background: p?.color || '#999' } }), name);
}

/** "Everyone" when it is everyone, else one chip per person. */
export function whoChips(names, { max = 9 } = {}) {
  const m = state.model;
  if (names.length === m.people.length && names.length > 1) {
    return h('span', { class: 'chips' }, h('span', { class: 'chip' }, h('span', { class: 'sw', style: { background: `conic-gradient(${conic(names)})` } }), 'Everyone'));
  }
  return h('span', { class: 'chips' }, names.slice(0, max).map(personChip), names.length > max ? h('span', { class: 'chip' }, `+${names.length - max}`) : null);
}

/** CSS conic-gradient stops for a set of people's colors. */
export function conic(names) {
  const colors = names.map((n) => state.model.peopleByName.get(n)?.color || '#888');
  if (!colors.length) return '#888 0 100%';
  const step = 100 / colors.length;
  return colors.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(', ');
}

export function statusBadge(status) {
  return h('span', { class: `status ${status}` }, status);
}

export function weatherChip(city, date, stay) {
  const loc = weatherLoc(state.model, city, stay);
  if (!loc) return null;
  const w = weatherFor(state.weather, loc, date);
  if (!w) return h('span', { class: 'wx' }, h('span', { class: 'muted' }, `${city}: weather not loaded yet`));
  const rain = w.rain === null || w.rain === undefined ? '' : w.kind === 'forecast' ? `${w.rain}% chance of rain` : `rain on ${w.rain}% of days`;
  return h('span', { class: 'wx', title: w.kind === 'typical' ? 'Typical: 10-year average for this date (±3 days), not a forecast' : 'Open-Meteo forecast' },
    h('span', null, city),
    h('span', { class: 'hi' }, `${w.hi}°`), h('span', { class: 'muted' }, `/ ${w.lo}°F`),
    rain ? h('span', { class: 'muted' }, `· ${rain}`) : null,
    h('span', { class: `tag ${w.kind}` }, w.kind === 'forecast' ? 'Forecast' : 'Typical'));
}

/**
 * One "Google Maps" link: the place, or for transport the route from → to. Places are searched
 * by name and address, so Google opens the actual restaurant or hotel (with its hours, photos and
 * reviews) instead of a dropped pin; coordinates are used only when there is nothing to search by.
 */
export function googleMapsLink(it) {
  let href;
  if (it.type === 'transport') {
    const end = (l, name) => (l && !l.approx ? `${l.lat},${l.lng}` : name);
    const o = end(it.fromLoc, it.from), d = end(it.toLoc, it.to);
    if (!o || !d) return null;
    href = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(o)}&destination=${encodeURIComponent(d)}&travelmode=transit`;
  } else {
    const q = placeQuery(it);
    if (!q) return null;
    href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }
  return h('a', { class: 'btn small', href, target: '_blank', rel: 'noopener' }, icon('pin', 14), 'Google Maps', icon('ext', 14));
}

/** What to search Google Maps for: "Name, Address" (or "Name, City"); coordinates as a last resort. */
export function placeQuery(it) {
  const generic = !it.title || /^(Stay in |Idea$|Note$)/.test(it.title) || it.type === 'note';
  const name = generic ? '' : it.title;
  const where = it.address || (name ? it.city : '');
  const q = [name, where].filter(Boolean).join(', ');
  if (q) return q;
  if (it.loc && !it.loc.approx) return `${it.loc.lat},${it.loc.lng}`;
  return it.city || '';
}

/** Only http(s) links from the Sheet become clickable (never javascript: etc.). */
export function safeUrl(u) {
  try {
    const url = new URL(String(u || '').trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

export function itemTimeLabel(it) {
  if (it.type === 'transport') return it.start ? `${it.start}${it.endTime ? `–${it.endTime}${it.overnight ? ' (+1)' : ''}` : ''}` : '';
  return it.start || '';
}

export const TYPE_ICON = { stay: 'stay', transport: 'transport', reservation: 'reservation', note: 'note', idea: 'idea' };
