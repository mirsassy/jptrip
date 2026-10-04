// Itinerary checks: double-booked people, nights with no stay, reservations in
// a city the person isn't in, and cancellation deadlines coming up.
import { addDays, toMinutes, fromMinutes, jstToMs, fmtDay, fmtShort } from './dates.js';
import { staysForNight, whereabouts, distanceKm, RESERVATION_MINUTES } from './model.js';

const SAME_PLACE_KM = 40; // a reservation within this distance of where someone is counts as "in the city"
const DEADLINE_WINDOW_MS = 72 * 3600 * 1000;

const active = (it) => it.status !== 'Cancelled';

function peopleLabel(model, names) {
  if (names.length === model.people.length && names.length > 1) return 'Everyone';
  return names.join(', ');
}

/** Intervals (in minutes from the item's date) a person is busy for an item. */
function interval(it) {
  const s = toMinutes(it.start);
  if (s === null) return null;
  if (it.type === 'transport') {
    let e = toMinutes(it.endTime);
    if (e === null) e = s + 60;
    if (e < s) e += 1440;
    return [s, Math.max(e, s + 1)];
  }
  if (it.type === 'reservation') return [s, s + RESERVATION_MINUTES];
  return null;
}

export function findConflicts(model, nowMs = Date.now()) {
  const out = [];
  if (!model.range) return out;
  const { start, end } = model.range;
  const dated = model.items.filter((it) => active(it) && it.date);

  // 1. Same person in two places at once
  const pairs = new Map();
  model.people.forEach(({ name }) => {
    const iv = dated
      .filter((it) => (it.type === 'transport' || it.type === 'reservation') && it.people.includes(name))
      .map((it) => {
        const v = interval(it);
        if (!v) return null;
        const day = Math.round((jstToMs(it.date) - jstToMs(start)) / 86400000);
        return { it, s: day * 1440 + v[0], e: day * 1440 + v[1] };
      })
      .filter(Boolean)
      .sort((a, b) => a.s - b.s);
    for (let i = 0; i < iv.length; i++) {
      for (let j = i + 1; j < iv.length && iv[j].s < iv[i].e; j++) {
        const key = [iv[i].it.id, iv[j].it.id].sort().join('|');
        if (!pairs.has(key)) pairs.set(key, { a: iv[i].it, b: iv[j].it, people: [] });
        pairs.get(key).people.push(name);
      }
    }
  });
  pairs.forEach(({ a, b, people }) => {
    const t = (x) => (x.type === 'transport' && x.endTime ? `${x.start}–${x.endTime}` : x.type === 'reservation' ? `${x.start}–${fromMinutes(toMinutes(x.start) + RESERVATION_MINUTES)}` : x.start);
    out.push({
      kind: 'overlap', severity: 'error', date: a.date, people, itemIds: [a.id, b.id],
      title: 'Double-booked',
      message: `${peopleLabel(model, people)}: “${a.title}” (${t(a)}) overlaps “${b.title}” (${t(b)}).`,
    });
  });

  // Two stays on the same night
  for (let d = start; d < end; d = addDays(d, 1)) {
    const dup = new Map();
    model.people.forEach(({ name }) => {
      const s = staysForNight(model, name, d);
      if (s.length > 1) {
        const key = s.map((x) => x.id).sort().join('|');
        if (!dup.has(key)) dup.set(key, { stays: s, people: [] });
        dup.get(key).people.push(name);
      }
    });
    dup.forEach(({ stays, people }) => out.push({
      kind: 'two-stays', severity: 'error', date: d, people, itemIds: stays.map((s) => s.id),
      title: 'Two stays on one night',
      message: `Night of ${fmtDay(d)}: ${peopleLabel(model, people)} booked at ${stays.map((s) => s.title).join(' and ')}.`,
    }));
  }

  // 2. Nights with no stay (unless travelling overnight)
  for (let d = start; d < end; d = addDays(d, 1)) {
    const missing = model.people.map((p) => p.name).filter((n) => {
      if (staysForNight(model, n, d).length) return false;
      return !whereabouts(model, n, d).overnightTransport;
    });
    if (missing.length) {
      out.push({
        kind: 'no-stay', severity: 'warn', date: d, people: missing, itemIds: [],
        title: 'No place to sleep',
        message: `Night of ${fmtDay(d)}: no stay for ${peopleLabel(model, missing)}.`,
      });
    }
  }

  // 3. Reservation in a city the person isn't in that day
  dated.filter((it) => it.type === 'reservation' && it.city).forEach((it) => {
    const away = [];
    const where = new Set();
    it.people.forEach((n) => {
      const w = whereabouts(model, n, it.date);
      if (!w.cities.length) return; // no stay info: reported as "no stay" instead
      const nameMatch = w.cities.some((c) => c.toLowerCase().includes(it.city.toLowerCase()) || it.city.toLowerCase().includes(c.toLowerCase()));
      if (nameMatch) return;
      const resLoc = it.loc;
      const near = resLoc && w.cities.some((c) => { const cc = model.cityCoord(c); return cc && distanceKm(cc, resLoc) <= SAME_PLACE_KM; })
        || resLoc && [...w.tonight, ...w.lastNight].some((s) => s.loc && distanceKm(s.loc, resLoc) <= SAME_PLACE_KM);
      if (near) return;
      away.push(n);
      w.cities.forEach((c) => where.add(c));
    });
    if (away.length) {
      out.push({
        kind: 'wrong-city', severity: 'warn', date: it.date, people: away, itemIds: [it.id],
        title: 'Reservation in another city',
        message: `“${it.title}” is in ${it.city} on ${fmtDay(it.date)}, but ${peopleLabel(model, away)} ${away.length === 1 ? 'is' : 'are'} in ${[...where].join(' / ')} that day.`,
      });
    }
  });

  // 4. Cancellation deadlines in the next 72 hours
  dated.filter((it) => it.deadline).forEach((it) => {
    const ms = jstToMs(it.deadline.date, it.deadline.time);
    const left = ms - nowMs;
    if (left > 0 && left <= DEADLINE_WINDOW_MS) {
      const h = Math.floor(left / 3600000);
      out.push({
        kind: 'deadline', severity: 'warn', date: it.date, people: it.people, itemIds: [it.id],
        title: 'Cancellation deadline soon',
        message: `“${it.title}” (${fmtShort(it.date)}): free cancellation ends ${fmtDay(it.deadline.date)} ${it.deadline.time} JST, in ${h < 1 ? 'under an hour' : `${h} h`}.`,
      });
    }
  });

  // 5. Children without a parent (an adult who shares a group with them), or without any adult
  const byName = new Map(model.people.map((p) => [p.name, p]));
  dated.filter((it) => it.type === 'stay' || it.type === 'transport' || it.type === 'reservation').forEach((it) => {
    const kids = it.people.map((n) => byName.get(n)).filter((p) => p && p.child);
    if (!kids.length) return;
    const adultsHere = it.people.filter((n) => byName.get(n) && !byName.get(n).child);
    const when = it.type === 'stay' ? `${fmtShort(it.date)}–${fmtShort(it.endDate)}` : fmtShort(it.date);
    if (!adultsHere.length) {
      out.push({
        kind: 'child-alone', severity: 'error', date: it.date, people: kids.map((k) => k.name), itemIds: [it.id],
        title: 'Child with no adult',
        message: `“${it.title}” (${when}) has ${kids.map((k) => k.name).join(', ')} but no adult.`,
      });
      return;
    }
    const noParent = kids.filter((k) => k.parents.length && !k.parents.some((a) => it.people.includes(a)));
    if (noParent.length) {
      out.push({
        kind: 'child-no-parent', severity: 'warn', date: it.date, people: noParent.map((k) => k.name), itemIds: [it.id],
        title: 'Child without a parent',
        message: `“${it.title}” (${when}): ${noParent.map((k) => `${k.name} is there without ${k.parents.join(' or ')}`).join('; ')}.`,
      });
    }
  });

  // 6. Party size that doesn't match Who
  dated.filter((it) => it.type === 'reservation' && it.partySize !== null && it.partySize !== undefined && it.who).forEach((it) => {
    if (it.partySize !== it.people.length) {
      out.push({
        kind: 'party-size', severity: 'info', date: it.date, people: [], itemIds: [it.id],
        title: 'Party size differs from Who',
        message: `“${it.title}” (${fmtShort(it.date)}) is booked for ${it.partySize}, but Who lists ${it.people.length}: ${model.partySummary(it.people)}.`,
      });
    }
  });

  // Rows the app could not read properly
  model.issues.forEach((iss) => {
    if (iss.kind === 'unknown-name') {
      out.push({ kind: 'data', severity: 'info', date: null, people: [], itemIds: [iss.id].filter(Boolean), title: 'Unknown name in Who', message: `${iss.tab} row ${iss.row}: “${iss.names.join(', ')}” is not a person or group. Check the spelling or add a group.` });
    } else if (iss.kind === 'bad-dates') {
      out.push({ kind: 'data', severity: 'info', date: null, people: [], itemIds: [iss.id].filter(Boolean), title: 'Date missing or unreadable', message: `${iss.tab} row ${iss.row}: check the date${iss.tab === 'Stays' ? 's (check-out must be after check-in)' : ''}.` });
    }
  });

  const sevRank = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || String(a.date).localeCompare(String(b.date)));
}
