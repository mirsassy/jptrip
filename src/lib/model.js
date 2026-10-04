// Turns the raw Sheet rows into a model the views can use: people, groups,
// cities, and one "item" per row with resolved people, dates and coordinates.
import { parseDate, parseTime, toMinutes, addDays, diffDays } from './dates.js';

export const TYPES = ['stay', 'transport', 'reservation', 'note', 'idea'];
export const TYPE_LABELS = { stay: 'Stay', transport: 'Transport', reservation: 'Reservation', note: 'Note', idea: 'Restaurant idea' };
export const TAB_OF_TYPE = { stay: 'Stays', transport: 'Transport', reservation: 'Reservations', note: 'Notes', idea: 'Restaurant ideas' };
export const STATUSES = ['Idea', 'Tentative', 'Confirmed', 'Cancelled'];
export const RESERVATION_MINUTES = 120; // assumed length of a reservation for overlap checks
const FALLBACK_COLORS = ['#1F77B4', '#FF7F0E', '#2CA02C', '#D62728', '#9467BD', '#8C564B', '#E377C2', '#17BECF', '#BCBD22', '#7F7F7F'];

const norm = (s) => String(s ?? '').trim();
const lc = (s) => norm(s).toLowerCase();
const num = (v) => (v === '' || v === null || v === undefined || !isFinite(Number(v)) ? null : Number(v));

export function normStatus(s) {
  const v = lc(s);
  const hit = STATUSES.find((x) => x.toLowerCase() === v);
  return hit || (v ? norm(s) : 'Idea');
}

export function yesNo(v) {
  const s = lc(v);
  if (['yes', 'y', 'true'].includes(s) || v === true) return 'Yes';
  if (['no', 'n', 'false'].includes(s) || v === false) return 'No';
  return s ? 'Unsure' : '';
}

/** Great-circle distance in km. */
export function distanceKm(a, b) {
  const R = 6371;
  const toR = (x) => (x * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function buildModel(data) {
  const tabs = data?.tabs || {};
  const rows = (name) => tabs[name]?.rows || [];

  const people = rows('People').filter((r) => norm(r.Name)).map((r, i) => {
    const color = /^#?[0-9a-f]{6}$/i.test(norm(r['Color (hex)'])) ? `#${norm(r['Color (hex)']).replace('#', '')}` : FALLBACK_COLORS[i % FALLBACK_COLORS.length];
    const age = norm(r.Notes).match(/\bage\s*(\d{1,2})\b/i);
    return { name: norm(r.Name), color, child: lc(r['Adult or child']) === 'child', age: age ? +age[1] : null, notes: norm(r.Notes), raw: r };
  });
  const peopleByLc = new Map(people.map((p) => [p.name.toLowerCase(), p]));
  const allNames = people.map((p) => p.name);

  const groups = [];
  rows('Groups').forEach((r) => {
    const name = norm(r.Group);
    if (!name) return;
    const members = norm(r.Members).split(/[,;]/).map(lc).filter(Boolean).map((n) => peopleByLc.get(n)?.name).filter(Boolean);
    groups.push({ name, members, notes: norm(r.Notes), raw: r });
  });
  // "Everyone" is always the whole People tab, whatever a Groups row of that name lists
  const realGroups = groups.filter((g) => g.name.toLowerCase() !== 'everyone');
  groups.length = 0;
  groups.push(...realGroups);
  // Groups double as families: a child's parents are the adults who share a group with them
  groups.forEach((g) => {
    g.adults = g.members.filter((n) => !peopleByLc.get(n.toLowerCase()).child);
    g.children = g.members.filter((n) => peopleByLc.get(n.toLowerCase()).child);
  });
  people.forEach((p) => {
    p.groups = groups.filter((g) => g.members.includes(p.name)).map((g) => g.name);
    const adults = [...new Set(groups.filter((g) => g.members.includes(p.name)).flatMap((g) => g.adults))];
    p.parents = p.child ? adults : [];
  });
  const everyone = { name: 'Everyone', members: allNames, adults: [], children: [], implicit: true };

  const groupsByLc = new Map();
  groups.forEach((g) => groupsByLc.set(g.name.toLowerCase(), g));
  groupsByLc.set('everyone', everyone);

  const lists = data?.lists?.columns || {};
  const cities = (data?.lists?.cities || []).map((c) => ({ name: c.name, lat: num(c.lat), lng: num(c.lng) }));
  const cityByLc = new Map(cities.map((c) => [c.name.toLowerCase(), c]));
  const cityCoord = (name) => {
    const c = cityByLc.get(lc(name));
    return c && c.lat !== null && c.lng !== null ? { lat: c.lat, lng: c.lng } : null;
  };

  /**
   * "Everyone", "Avery & Blake" (a household), or "Avery, Blake, Kit" -> people names. Blank means everyone.
   * Parts are split on commas; a part that isn't a known name is split again on "&" / "and".
   */
  function resolveWho(who) {
    const parts = norm(who).split(/[,;]/).map(norm).filter(Boolean);
    if (!parts.length) return { people: allNames.slice(), unknown: [], blank: true };
    const set = new Set();
    const unknown = [];
    const add = (t) => {
      const g = groupsByLc.get(t.toLowerCase());
      if (g) { g.members.forEach((m) => set.add(m)); return true; }
      const p = peopleByLc.get(t.toLowerCase());
      if (p) { set.add(p.name); return true; }
      return false;
    };
    parts.forEach((part) => {
      if (add(part)) return;
      part.split(/&|\band\b/i).map(norm).filter(Boolean).forEach((t) => { if (!add(t)) unknown.push(t); });
    });
    return { people: allNames.filter((n) => set.has(n)), unknown, blank: false };
  }

  /** "4 adults, 2 children (7, 3)" for a list of people. */
  function partySummary(names) {
    const ps = names.map((n) => peopleByLc.get(n.toLowerCase())).filter(Boolean);
    const kids = ps.filter((p) => p.child);
    const adults = ps.length - kids.length;
    const ages = kids.map((k) => k.age).filter((a) => a !== null);
    const parts = [];
    if (adults) parts.push(`${adults} adult${adults === 1 ? '' : 's'}`);
    if (kids.length) parts.push(`${kids.length} child${kids.length === 1 ? '' : 'ren'}${ages.length === kids.length ? ` (${ages.join(', ')})` : ''}`);
    return parts.join(', ');
  }

  // Dates typed without a year ("11/7") take the year of the trip's stays, or the current year.
  const yearGuess = (() => {
    for (const r of rows('Stays')) { const d = parseDate(r['Check-in']); if (d) return +d.slice(0, 4); }
    return new Date().getFullYear();
  })();
  const pd = (v) => parseDate(v, yearGuess);

  const items = [];
  const issues = []; // rows the app could not fully understand

  const base = (tab, type, r) => {
    const who = resolveWho(r.Who);
    if (who.unknown.length) issues.push({ kind: 'unknown-name', tab, id: r.ID, row: r._row, names: who.unknown });
    return { id: norm(r.ID) || `${tab}#${r._row}`, tab, type, row: r._row, raw: r, status: normStatus(r.Status), who: norm(r.Who), people: who.people, unknownNames: who.unknown };
  };
  const coordOr = (lat, lng, city) => {
    const la = num(lat), ln = num(lng);
    if (la !== null && ln !== null) return { lat: la, lng: ln, approx: false };
    const c = cityCoord(city);
    return c ? { ...c, approx: true } : null;
  };

  rows('Stays').forEach((r) => {
    const it = base('Stays', 'stay', r);
    it.date = pd(r['Check-in']);
    it.endDate = pd(r['Check-out']);
    if (!it.date || !it.endDate || it.endDate <= it.date) issues.push({ kind: 'bad-dates', tab: 'Stays', id: it.id, row: r._row });
    it.city = norm(r.City);
    it.cities = [it.city].filter(Boolean);
    it.title = norm(r.Hotel) || `Stay in ${it.city || '?'}`;
    it.address = norm(r.Address);
    it.loc = coordOr(r.Lat, r.Lng, it.city);
    items.push(it);
  });

  rows('Transport').forEach((r) => {
    const it = base('Transport', 'transport', r);
    it.date = pd(r.Date);
    if (!it.date) issues.push({ kind: 'bad-dates', tab: 'Transport', id: it.id, row: r._row });
    it.start = parseTime(r.Depart);
    it.endTime = parseTime(r.Arrive);
    it.mode = norm(r.Mode);
    it.from = norm(r.From);
    it.to = norm(r.To);
    it.cities = [it.from, it.to].filter(Boolean);
    it.title = `${it.mode || 'Trip'}: ${it.from || '?'} → ${it.to || '?'}`;
    it.carrier = norm(r['Carrier / train']);
    it.fromLoc = coordOr(r['From Lat'], r['From Lng'], it.from);
    it.toLoc = coordOr(r['To Lat'], r['To Lng'], it.to);
    const s = toMinutes(it.start), e = toMinutes(it.endTime);
    it.overnight = s !== null && e !== null && e < s;
    items.push(it);
  });

  rows('Reservations').forEach((r) => {
    const it = base('Reservations', 'reservation', r);
    it.date = pd(r.Date);
    if (!it.date) issues.push({ kind: 'bad-dates', tab: 'Reservations', id: it.id, row: r._row });
    it.start = parseTime(r.Time);
    it.kind = norm(r.Type);
    it.title = norm(r.Name) || it.kind || 'Reservation';
    it.city = norm(r.City);
    it.cities = [it.city].filter(Boolean);
    it.address = norm(r.Address);
    it.kid = yesNo(r['Kid-friendly']);
    it.link = norm(r.Link);
    it.partySize = num(r['Party size']);
    const dl = norm(r['Cancellation deadline']);
    it.deadline = dl ? { date: pd(dl), time: parseTime(dl) || '23:59' } : null;
    if (it.deadline && !it.deadline.date) it.deadline = null;
    it.loc = coordOr(r.Lat, r.Lng, it.city);
    items.push(it);
  });

  rows('Notes').forEach((r) => {
    const it = base('Notes', 'note', r);
    it.date = pd(r.Date);
    it.city = norm(r.City);
    it.cities = [it.city].filter(Boolean);
    it.title = norm(r.Note);
    it.loc = coordOr(null, null, it.city);
    items.push(it);
  });

  rows('Restaurant ideas').forEach((r) => {
    const it = base('Restaurant ideas', 'idea', r);
    it.people = [];
    it.city = norm(r.City);
    it.cities = [it.city].filter(Boolean);
    it.title = norm(r.Name) || 'Restaurant idea';
    it.cuisine = norm(r.Cuisine);
    it.price = norm(r['Price range']);
    it.kid = yesNo(r['Kid-friendly']);
    it.link = norm(r.Link);
    it.address = norm(r.Address);
    it.loc = coordOr(r.Lat, r.Lng, it.city);
    items.push(it);
  });

  // Trip range: earliest to latest date on any non-cancelled dated row.
  let start = null, end = null;
  items.forEach((it) => {
    if (it.status === 'Cancelled' || !it.date) return;
    const last = it.endDate || it.date;
    if (!start || it.date < start) start = it.date;
    if (!end || last > end) end = last;
  });

  const model = {
    people, groups, everyone, cities, lists, items, issues, resolveWho, partySummary, cityCoord,
    peopleByName: new Map(people.map((p) => [p.name, p])),
    range: start ? { start, end } : null,
    itemById: new Map(items.map((i) => [i.id, i])),
  };
  return model;
}

const active = (it) => it.status !== 'Cancelled';

/** Stays covering the night that starts on `date`, for one person. */
export function staysForNight(model, person, date) {
  return model.items
    .filter((it) => it.type === 'stay' && active(it) && it.date && it.endDate && it.date <= date && date < it.endDate && it.people.includes(person))
    .sort((a, b) => a.people.length - b.people.length); // the most specific stay first
}

/** Everything known about where a person is on a date. */
export function whereabouts(model, person, date) {
  const tonight = staysForNight(model, person, date);
  const lastNight = staysForNight(model, person, addDays(date, -1));
  const transport = model.items.filter((it) => it.type === 'transport' && active(it) && it.date === date && it.people.includes(person));
  const cities = [];
  const add = (c) => { if (c && !cities.some((x) => x.toLowerCase() === c.toLowerCase())) cities.push(c); };
  lastNight.forEach((s) => add(s.city));
  transport.slice().sort(byTime).forEach((t) => { add(t.from); add(t.to); });
  tonight.forEach((s) => add(s.city));
  const overnightTransport = transport.find((t) => t.overnight) || null;
  return { person, date, tonight, lastNight, transport, cities, overnightTransport };
}

export function byTime(a, b) {
  const ta = toMinutes(a.start), tb = toMinutes(b.start);
  if (ta === null && tb === null) return 0;
  if (ta === null) return -1;
  if (tb === null) return 1;
  return ta - tb;
}

/**
 * Splits the people for a date into ad hoc groups by where they sleep that
 * night, and builds each group's timeline.
 *
 * @param {(it) => boolean} pass  item filter
 * @param {string[]} onlyPeople   people to include (empty = everyone)
 */
export function dayGroups(model, date, { pass = () => true, onlyPeople = [] } = {}) {
  const names = model.people.map((p) => p.name).filter((n) => !onlyPeople.length || onlyPeople.includes(n));
  const buckets = new Map();
  names.forEach((n) => {
    const w = whereabouts(model, n, date);
    const stay = w.tonight[0];
    const key = stay ? `stay:${stay.id}` : w.overnightTransport ? `transit:${w.overnightTransport.id}` : 'none';
    if (!buckets.has(key)) buckets.set(key, { key, people: [], stay: stay || null, transit: stay ? null : w.overnightTransport, cities: [], whereabouts: [] });
    const b = buckets.get(key);
    b.people.push(n);
    b.whereabouts.push(w);
    w.cities.forEach((c) => { if (!b.cities.some((x) => x.toLowerCase() === c.toLowerCase())) b.cities.push(c); });
  });

  const groups = [...buckets.values()];
  groups.forEach((g) => {
    const has = (it) => it.people.some((p) => g.people.includes(p));
    const timeline = [];
    // Check-outs from last night's stays (when not staying on)
    const seen = new Set();
    g.whereabouts.forEach((w) => w.lastNight.forEach((s) => {
      if (s.endDate === date && !seen.has(s.id) && pass(s)) { seen.add(s.id); timeline.push({ kind: 'checkout', item: s }); }
    }));
    model.items.filter((it) => (it.type === 'transport' || it.type === 'reservation' || it.type === 'note') && it.date === date && has(it) && pass(it))
      .forEach((it) => timeline.push({ kind: it.type, item: it }));
    if (g.stay && pass(g.stay)) timeline.push({ kind: g.stay.date === date ? 'checkin' : 'staying', item: g.stay });
    const rank = (e) => (e.kind === 'checkout' ? 0 : e.kind === 'checkin' || e.kind === 'staying' ? 3 : e.item.start ? 1 : e.kind === 'note' ? 2 : 1);
    timeline.sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      if (ra === 1 && rb === 1) return byTime(a.item, b.item);
      return ra - rb;
    });
    g.timeline = timeline;
    g.label = g.stay ? `${g.stay.city || 'Unknown city'}` : g.transit ? 'Overnight travel' : 'No stay booked';
  });
  // Larger groups first, "no stay" last
  groups.sort((a, b) => (a.key === 'none') - (b.key === 'none') || b.people.length - a.people.length);
  return groups;
}

/** Which day the app opens on: today during the trip, the first day before it, the last day after it. */
export function defaultDate(model, today) {
  if (!model.range) return today;
  if (today < model.range.start) return model.range.start;
  if (today > model.range.end) return model.range.end;
  return today;
}

export function tripDays(model, today) {
  if (!model.range) return [today];
  const n = diffDays(model.range.start, model.range.end);
  return Array.from({ length: n + 1 }, (_, i) => addDays(model.range.start, i));
}
