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

  it('turns a hotel booking into a Stays row with the file attached', () => {
    const r = toRow(FAKE_CLAUDE_ITEMS[0], model, 'https://drive.google.com/file/d/abc1234567/view');
    expect(r.tab).toBe('Stays');
    expect(r.values).toEqual({
      'Check-in': '2030-03-05', 'Check-out': '2030-03-08', City: 'Otaru', Hotel: 'Harbor View Hotel', Address: '1-2-3 Ironai, Otaru',
      Status: 'Confirmed', 'Confirmation #': 'HV-0042', Notes: 'Two rooms, breakfast included',
      Attachment: 'https://drive.google.com/file/d/abc1234567/view', Who: 'Avery, Kit',
    });
    expect(rowSummary(r)).toBe('Harbor View Hotel · Otaru · 2030-03-05 → 2030-03-08');
  });

  it('turns a flight into a Transport row, matching the Mode list and known cities', () => {
    const r = toRow(FAKE_CLAUDE_ITEMS[1], model);
    expect(r.tab).toBe('Transport');
    expect(r.values).toMatchObject({ Date: '2030-03-04', Depart: '09:10', Arrive: '10:40', Mode: 'Flight', From: 'Haneda Airport', To: 'Sapporo', 'Carrier / train': 'Air Example 123', Seats: '12A-12D', Who: 'Casey, Drew' });
    expect(r.values.Attachment).toBeUndefined();
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
