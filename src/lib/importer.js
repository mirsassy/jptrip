// Turns the rows Claude read from a booking (see extract_ in Code.gs) into
// Sheet rows for the add forms. Nothing is saved here: each row opens in its
// form so a person checks it and picks who is going before it is added.

const TAB = { stay: 'Stays', transport: 'Transport', reservation: 'Reservations', note: 'Notes' };

/** Context sent along with the document: trip dates and the Lists choices. Never people's names. */
export function importHints(model) {
  return {
    start: model.range?.start || '',
    end: model.range?.end || '',
    cities: model.cities.map((c) => c.name),
    modes: (model.lists.Mode || []).map(String),
    types: (model.lists['Reservation type'] || []).map(String),
  };
}

const clean = (v) => String(v ?? '').trim();
const pick = (v, options) => options.find((o) => String(o).toLowerCase() === clean(v).toLowerCase()) ?? clean(v);

/**
 * Matches guest names as written in a booking ("SMITH/AVERY MS", "Avery Smith", "Kit")
 * to People tab names: a person matches when their name is one of the guest's words.
 */
export function matchGuests(guests, people) {
  const names = new Set();
  const unmatched = [];
  (guests || []).forEach((g) => {
    const words = clean(g).toLowerCase().split(/[^\p{L}\p{N}'-]+/u).filter(Boolean);
    const found = people.filter((p) => {
      const pw = p.name.toLowerCase().split(/\s+/);
      return pw.every((w) => words.includes(w));
    });
    if (found.length === 1) names.add(found[0].name);
    else if (clean(g)) unmatched.push(clean(g));
  });
  return { names: people.map((p) => p.name).filter((n) => names.has(n)), unmatched };
}

const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(clean(v)) ? clean(v) : '');
const time = (v) => (/^\d{1,2}:\d{2}$/.test(clean(v)) ? clean(v).padStart(5, '0') : '');
const deadline = (v) => (/^\d{4}-\d{2}-\d{2}( \d{1,2}:\d{2})?$/.test(clean(v)) ? clean(v) : '');
const httpLink = (v) => (/^https?:\/\//i.test(clean(v)) ? clean(v) : '');

/** One extracted item -> { tab, values, unmatched } ready for openEditor(tab, null, values). */
export function toRow(item, model) {
  const tab = TAB[item.kind] || 'Notes';
  const cities = model.cities.map((c) => c.name);
  const statuses = model.lists.Status?.length ? model.lists.Status.map(String) : ['Idea', 'Tentative', 'Confirmed', 'Cancelled'];
  const { names, unmatched } = matchGuests(item.guests, model.people);
  const notes = clean(item.notes);
  const v = {};
  const put = (col, val) => { if (clean(val)) v[col] = clean(val); };

  if (tab === 'Notes') {
    put('Date', date(item.date));
    put('City', pick(item.city, cities));
    put('Note', [clean(item.name), notes].filter(Boolean).join(' — '));
  } else {
    put('Status', pick(item.status, statuses));
    put('Confirmation #', item.confirmation);
    put('Notes', notes);
  }
  if (tab === 'Stays') {
    put('Check-in', date(item.date));
    put('Check-out', date(item.end_date));
    put('City', pick(item.city, cities));
    put('Hotel', item.name);
    put('Address', item.address);
  }
  if (tab === 'Transport') {
    put('Date', date(item.date));
    put('Depart', time(item.time));
    put('Arrive', time(item.end_time));
    put('Mode', pick(item.mode, (model.lists.Mode || []).map(String)));
    put('From', pick(item.from, cities));
    put('To', pick(item.to, cities));
    put('Carrier / train', item.name);
    put('Seats', item.seats);
  }
  if (tab === 'Reservations') {
    put('Date', date(item.date));
    put('Time', time(item.time));
    put('Type', pick(item.reservation_type, (model.lists['Reservation type'] || []).map(String)));
    put('Name', item.name);
    put('City', pick(item.city, cities));
    put('Address', item.address);
    if (/^\d{1,3}$/.test(clean(item.party_size))) v['Party size'] = clean(item.party_size);
    put('Cancellation deadline', deadline(item.cancellation_deadline));
    put('Link', httpLink(item.link));
  }
  if (names.length) v.Who = names.join(', ');
  return { tab, values: v, unmatched };
}

/** A one-line description of an extracted row, e.g. "Harbor View Hotel · Otaru · 2030-03-05 → 2030-03-08". */
export function rowSummary({ tab, values: v }) {
  const parts = {
    Stays: [v.Hotel || 'Stay', v.City, v['Check-in'] && `${v['Check-in']}${v['Check-out'] ? ` → ${v['Check-out']}` : ''}`],
    Transport: [v['Carrier / train'] || v.Mode || 'Transport', [v.From, v.To].filter(Boolean).join(' → '), [v.Date, v.Depart].filter(Boolean).join(' ')],
    Reservations: [v.Name || 'Reservation', v.City, [v.Date, v.Time].filter(Boolean).join(' ')],
    Notes: [v.Note, v.Date],
  }[tab] || [];
  return parts.filter(Boolean).join(' · ');
}
