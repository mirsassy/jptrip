import { describe, it, expect } from 'vitest';
import { createGas, FAKE_CLAUDE_ITEMS } from '../../dev/gas-fake.mjs';
import { buildModel } from '../../src/lib/model.js';
import { importHints, matchGuests, toRow, rowSummary } from '../../src/lib/importer.js';

const g = createGas();
const model = buildModel(g.post({ action: 'read', token: g.login() }).data);
const blank = Object.fromEntries(Object.keys(FAKE_CLAUDE_ITEMS[0]).map((k) => [k, k === 'guests' ? [] : '']));

describe('importing bookings read by Claude', () => {
  it('sends trip dates and Lists choices as hints, never names', () => {
    const hints = importHints(model);
    expect(hints).toMatchObject({ start: '2030-03-04', end: '2030-03-27' });
    expect(hints.cities).toContain('Otaru');
    expect(hints.modes).toContain('Flight');
    expect(hints.types).toContain('Restaurant');
    expect(JSON.stringify(hints)).not.toMatch(/Avery|Blake|Kit|Robin/);
  });

  it('matches guest names as written in bookings to People', () => {
    const r = matchGuests(['Avery Example', 'EXAMPLE/BLAKE MR', 'kit', 'Pat Stranger', ''], model.people);
    expect(r.names).toEqual(['Avery', 'Blake', 'Kit']);
    expect(r.unmatched).toEqual(['Pat Stranger']);
    // A word inside another word is not a match
    expect(matchGuests(['Caseyville Hotel guest'], model.people).names).toEqual([]);
  });

  it('turns a hotel booking into a Stays row', () => {
    const r = toRow(FAKE_CLAUDE_ITEMS[0], model);
    expect(r.tab).toBe('Stays');
    expect(r.values).toEqual({
      'Check-in': '2030-03-05', 'Check-out': '2030-03-08', City: 'Otaru', Hotel: 'Harbor View Hotel', Address: '1-2-3 Ironai, Otaru',
      Status: 'Confirmed', 'Confirmation #': 'HV-0042', Notes: 'Two rooms, breakfast included',
      Who: 'Avery, Kit',
    });
    expect(rowSummary(r)).toBe('Harbor View Hotel · Otaru · 2030-03-05 → 2030-03-08');
  });

  it('turns a flight into a Transport row, matching the Mode list and known cities', () => {
    const r = toRow(FAKE_CLAUDE_ITEMS[1], model);
    expect(r.tab).toBe('Transport');
    expect(r.values).toMatchObject({ Date: '2030-03-04', Depart: '09:10', Arrive: '10:40', Mode: 'Flight', From: 'Haneda Airport', To: 'Sapporo', 'Carrier / train': 'Air Example 123', Seats: '12A-12D', Who: 'Casey, Drew' });
    expect(r.unmatched).toEqual(['Pat Stranger']);
  });

  it('turns a restaurant booking into a Reservations row and drops malformed values', () => {
    const r = toRow({ ...blank, kind: 'reservation', status: 'Tentative', name: 'Sushi Example', date: '2030-03-06', time: '7:00', city: 'otaru', reservation_type: 'restaurant', party_size: 'four', cancellation_deadline: 'the day before', link: 'javascript:alert(1)' }, model);
    expect(r.values).toEqual({ Status: 'Tentative', Date: '2030-03-06', Time: '07:00', Type: 'Restaurant', Name: 'Sushi Example', City: 'Otaru' });
  });

  it('leaves Who empty when no guest matches, so the form asks', () => {
    const r = toRow({ ...blank, kind: 'reservation', name: 'Tour', date: '2030-03-09', guests: ['Pat Stranger'] }, model);
    expect(r.values.Who).toBeUndefined();
  });

  it('turns anything else into a Notes row', () => {
    const r = toRow({ ...blank, kind: 'note', name: 'Luggage forwarding', date: '2030-03-08', notes: 'Send bags from Otaru to Hakodate', city: 'Otaru' }, model);
    expect(r).toMatchObject({ tab: 'Notes', values: { Date: '2030-03-08', City: 'Otaru', Note: 'Luggage forwarding — Send bags from Otaru to Hakodate' } });
  });
});

import { closedOn, ideasFor } from '../../src/lib/ideas.js';
describe('ideas for a day', () => {
  it('spots a closing day in a timing note', () => {
    expect(closedOn('Usually closed Mondays (Nov 9).', '2026-11-09')).toBe(true);
    expect(closedOn('Usually closed Mondays (Nov 9).', '2026-11-10')).toBe(false);
    expect(closedOn('Many shops close Sundays and some Wednesdays; go in the morning.', '2026-11-11')).toBe(true);
    expect(closedOn('Crab season opens Nov 6, so kobako is on sale from Nov 7. Many stalls close by mid-afternoon.', '2026-11-07')).toBe(false);
    expect(closedOn('', '2026-11-07')).toBe(false);
  });

  it('lists open ideas in the given cities, Michelin first, closed-that-day last', () => {
    const g2 = createGas();
    const t = g2.login();
    const add = (values) => g2.post({ action: 'upsert', token: t, tab: 'Ideas', values });
    add({ ID: 'I-a', Name: 'Aquarium', City: 'Otaru', Type: 'Activity', Status: 'Idea', 'Timing / closed days': 'Closed Thursdays.' });
    add({ ID: 'I-b', Name: 'Bistro', City: 'Otaru', Type: 'Restaurant', Status: 'Idea' });
    add({ ID: 'I-c', Name: 'Crab house', City: 'Otaru', Type: 'Restaurant', Michelin: 'Bib Gourmand', Status: 'Idea' });
    add({ ID: 'I-d', Name: 'Done deal', City: 'Otaru', Type: 'Restaurant', Status: 'Confirmed' });
    add({ ID: 'I-e', Name: 'Elsewhere', City: 'Sapporo', Type: 'Restaurant', Status: 'Idea' });
    const m2 = buildModel(g2.post({ action: 'read', token: t }).data);
    expect(ideasFor(m2, ['otaru'], { date: '2030-03-07' }).map((i) => i.title)).toEqual(['Crab house', 'Bistro', 'Aquarium']);
  });
});
