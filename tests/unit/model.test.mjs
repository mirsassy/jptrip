import { describe, it, expect } from 'vitest';
import { createGas } from '../../dev/gas-fake.mjs';
import { buildModel, dayGroups, defaultDate, whereabouts } from '../../src/lib/model.js';
import { findConflicts } from '../../src/lib/conflicts.js';
import { makePass, DEFAULT_FILTERS, selectedPeople } from '../../src/lib/filters.js';
import { parseDate, parseTime, jstToMs, jpNow, fmtDay, addDays } from '../../src/lib/dates.js';

// Fictional test trip (dev/gas-fake.mjs): Mar 4–27, 2030, nine people, no stay on the night of Mar 11.
function setup(rows = []) {
  const g = createGas();
  const token = g.login();
  rows.forEach(([tab, values]) => g.post({ action: 'upsert', token, tab, values }));
  return buildModel(g.post({ action: 'read', token }).data);
}

describe('dates', () => {
  it('parses the formats people type', () => {
    expect(parseDate('3/7/2030')).toBe('2030-03-07');
    expect(parseDate('3/7', 2030)).toBe('2030-03-07');
    expect(parseDate('Thu Mar 7', 2030)).toBe('2030-03-07');
    expect(parseDate('2030-03-06 18:30')).toBe('2030-03-06');
    expect(parseDate('2/30/2030')).toBe(null);
    expect(parseTime('6:30 PM')).toBe('18:30');
    expect(parseTime('2030-03-06 18:30')).toBe('18:30');
    expect(parseTime('9:05')).toBe('09:05');
    expect(fmtDay('2030-03-04')).toBe('Mon, Mar 4');
    expect(addDays('2030-03-31', 1)).toBe('2030-04-01');
  });
  it('uses Japan time', () => {
    expect(jstToMs('2030-03-07', '09:00')).toBe(Date.UTC(2030, 2, 7, 0, 0));
    expect(jpNow(Date.UTC(2030, 2, 6, 16, 0)).date).toBe('2030-03-07');
  });
});

describe('model', () => {
  it('derives the trip range and the default date from the data', () => {
    const m = setup();
    expect(m.range).toEqual({ start: '2030-03-04', end: '2030-03-27' });
    expect(defaultDate(m, '2030-01-15')).toBe('2030-03-04');
    expect(defaultDate(m, '2030-03-15')).toBe('2030-03-15');
    expect(defaultDate(m, '2030-05-01')).toBe('2030-03-27');
  });

  it('resolves groups and names in Who, and reports unknown names', () => {
    const m = setup();
    expect(m.resolveWho('Everyone').people).toHaveLength(9);
    expect(m.resolveWho('avery, Gale & Kit').people).toEqual(['Avery', 'Gale', 'Kit']);
    expect(m.resolveWho('Avery, Gale & Kit').unknown).toEqual([]);
    expect(m.resolveWho('Avery, Zed').unknown).toEqual(['Zed']);
  });

  it('splits the family into ad hoc groups by where they sleep', () => {
    const m = setup([
      ['Stays', { ID: 'S-split', 'Check-in': '2030-03-06', 'Check-out': '2030-03-07', City: 'Sapporo', Hotel: 'Sapporo Inn', Who: 'Avery, Blake', Status: 'Confirmed' }],
      ['Stays', { ID: 'S-x', 'Check-in': '2030-03-06', 'Check-out': '2030-03-07', City: 'Otaru', Hotel: 'Canal Hotel', Who: 'Casey, Drew, Emery, Frankie, Gale, Kit, Robin', Status: 'Confirmed' }],
      ['Transport', { ID: 'T-1', Date: '2030-03-06', Depart: '09:00', Arrive: '09:45', Mode: 'Local train', From: 'Otaru', To: 'Sapporo', Who: 'Avery, Blake', Status: 'Confirmed' }],
    ]);
    // The Otaru stay (Everyone, Mar 5–8) now overlaps the new ones on the night of the 6th
    const groups = dayGroups(m, '2030-03-06');
    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(whereabouts(m, 'Avery', '2030-03-06').cities).toEqual(['Otaru', 'Sapporo']);
    expect(findConflicts(m, Date.UTC(2030, 0, 1)).filter((c) => c.kind === 'two-stays').length).toBe(2);
  });

  it('builds a timeline in time order', () => {
    const m = setup([
      ['Reservations', { ID: 'R-a', Date: '2030-03-08', Time: '18:00', Name: 'Dinner', City: 'Hakodate', Who: 'Everyone' }],
      ['Transport', { ID: 'T-a', Date: '2030-03-08', Depart: '09:30', Arrive: '12:00', Mode: 'Limited express', From: 'Otaru', To: 'Hakodate', Who: 'Everyone' }],
      ['Notes', { ID: 'N-a', Date: '2030-03-08', City: 'Hakodate', Who: 'Kit', Note: 'Morning market' }],
    ]);
    const [g] = dayGroups(m, '2030-03-08');
    expect(g.label).toBe('Hakodate');
    expect(g.timeline.map((e) => e.kind)).toEqual(['checkout', 'transport', 'reservation', 'note', 'checkin']);
  });
});

describe('groups and families', () => {
  it('reads groups from the Groups tab; a child’s parents are the adults in their groups', () => {
    const m = setup();
    expect(m.groups.map((g) => [g.name, g.adults, g.children])).toEqual([
      ['Avery family', ['Avery', 'Blake'], ['Kit', 'Robin']],
      ['Casey and Drew', ['Casey', 'Drew'], []],
    ]);
    expect(m.peopleByName.get('Kit')).toMatchObject({ child: true, age: 7, groups: ['Avery family'], parents: ['Avery', 'Blake'] });
  });

  it('"Everyone" is always the whole People tab, whatever the Groups row lists', () => {
    const m = setup([['Groups', { Group: 'Everyone', Members: 'Avery' }]]);
    expect(m.resolveWho('Everyone').people).toHaveLength(9);
    expect(m.groups.some((g) => g.name === 'Everyone')).toBe(false);
  });

  it('a household name in Who means everyone in it; "&" and "and" still separate people', () => {
    const m = setup();
    expect(m.resolveWho('Avery family').people).toEqual(['Avery', 'Blake', 'Kit', 'Robin']);
    expect(m.resolveWho('Casey and Drew, Gale').people).toEqual(['Casey', 'Drew', 'Gale']);
    expect(m.resolveWho('Avery & Gale').people).toEqual(['Avery', 'Gale']);
    expect(m.resolveWho('Emery and Frankie').people).toEqual(['Emery', 'Frankie']);
  });

  it('summarises a party as adults and children', () => {
    const m = setup();
    expect(m.partySummary(['Avery', 'Blake', 'Kit', 'Robin', 'Gale'])).toBe('3 adults, 2 children (7, 3)');
    expect(m.partySummary(['Avery'])).toBe('1 adult');
    expect(m.partySummary(['Kit'])).toBe('1 child (7)');
  });

  it('flags a child with no adult, and a child without either parent', () => {
    const m = setup([
      ['Reservations', { ID: 'R-alone', Date: '2030-03-06', Time: '10:00', Name: 'Kids club', City: 'Otaru', Who: 'Kit, Robin' }],
      ['Reservations', { ID: 'R-np', Date: '2030-03-06', Time: '14:00', Name: 'Aquarium', City: 'Otaru', Who: 'Kit, Gale' }],
      ['Reservations', { ID: 'R-ok', Date: '2030-03-06', Time: '18:00', Name: 'Dinner', City: 'Otaru', Who: 'Avery family' }],
    ]);
    const c = findConflicts(m, 0);
    const alone = c.filter((x) => x.kind === 'child-alone');
    expect(alone.map((x) => x.itemIds[0])).toEqual(['R-alone']);
    expect(alone[0].severity).toBe('error');
    const np = c.filter((x) => x.kind === 'child-no-parent');
    expect(np.map((x) => x.itemIds[0])).toEqual(['R-np']);
    expect(np[0].message).toContain('Kit is there without Avery or Blake');
  });

  it('flags a party size that differs from Who', () => {
    const m = setup([
      ['Reservations', { ID: 'R-ps', Date: '2030-03-06', Time: '18:00', Name: 'Dinner', City: 'Otaru', Who: 'Avery family', 'Party size': 3 }],
      ['Reservations', { ID: 'R-ps2', Date: '2030-03-07', Time: '18:00', Name: 'Lunch', City: 'Otaru', Who: 'Avery family', 'Party size': 4 }],
    ]);
    const ps = findConflicts(m, 0).filter((x) => x.kind === 'party-size');
    expect(ps.map((x) => x.itemIds[0])).toEqual(['R-ps']);
    expect(ps[0].message).toContain('booked for 3, but Who lists 4: 2 adults, 2 children (7, 3)');
  });

  it('filters by household', () => {
    const m = setup();
    expect(selectedPeople(m, { ...DEFAULT_FILTERS, groups: ['Casey and Drew'] })).toEqual(['Casey', 'Drew']);
  });
});

describe('filters', () => {
  it('hides cancelled rows unless asked, and filters by person/group/city/type/date', () => {
    const m = setup([
      ['Reservations', { ID: 'R-c', Date: '2030-03-06', Time: '12:00', Name: 'Old', City: 'Otaru', Who: 'Avery', Status: 'Cancelled' }],
      ['Reservations', { ID: 'R-d', Date: '2030-03-06', Time: '12:00', Name: 'New', City: 'Otaru', Who: 'Robin', Status: 'Confirmed' }],
    ]);
    const ids = (f, o) => m.items.filter(makePass(m, { ...DEFAULT_FILTERS, ...f }, o)).map((i) => i.id);
    expect(ids({})).not.toContain('R-c');
    expect(ids({ statuses: ['Cancelled'] })).toEqual(['R-c']);
    expect(ids({ people: ['Avery'], types: ['reservation'] })).toEqual([]);
    expect(ids({ people: ['Robin'], types: ['reservation'] })).toEqual(['R-d']);
    expect(selectedPeople(m, { ...DEFAULT_FILTERS, groups: ['Avery family'] })).toHaveLength(4);
    expect(ids({ cities: ['Sendai'], types: ['stay'] })).toHaveLength(1);
    expect(ids({ from: '2030-03-19', to: '2030-03-19', types: ['stay'] })).toHaveLength(1);
  });
});

describe('conflicts', () => {
  it('flags the unassigned night of Mar 11 for everyone', () => {
    const m = setup();
    const noStay = findConflicts(m, Date.UTC(2030, 0, 1)).filter((x) => x.kind === 'no-stay');
    expect(noStay).toHaveLength(1);
    expect(noStay[0].date).toBe('2030-03-11');
    expect(noStay[0].message).toContain('Everyone');
  });

  it('does not flag a night spent on an overnight train', () => {
    const m = setup([['Transport', { ID: 'T-n', Date: '2030-03-11', Depart: '22:00', Arrive: '06:30', Mode: 'Bus', From: 'Sendai', To: 'Nikko', Who: 'Everyone' }]]);
    expect(findConflicts(m, 0).filter((x) => x.kind === 'no-stay')).toHaveLength(0);
  });

  it('flags overlapping times for the same person', () => {
    const m = setup([
      ['Transport', { ID: 'T-o', Date: '2030-03-08', Depart: '09:30', Arrive: '12:00', From: 'Otaru', To: 'Hakodate', Who: 'Everyone' }],
      ['Reservations', { ID: 'R-o', Date: '2030-03-08', Time: '11:00', Name: 'Glass workshop', City: 'Hakodate', Who: 'Avery, Frankie' }],
    ]);
    const o = findConflicts(m, 0).filter((x) => x.kind === 'overlap');
    expect(o).toHaveLength(1);
    expect(o[0].people).toEqual(['Avery', 'Frankie']);
  });

  it('flags a reservation in a city the person is not in, but not a nearby one', () => {
    const m = setup([
      ['Reservations', { ID: 'R-w', Date: '2030-03-06', Time: '19:00', Name: 'Beef tongue', City: 'Sendai', Who: 'Kit' }],
      ['Reservations', { ID: 'R-k', Date: '2030-03-23', Time: '19:00', Name: 'Soba', City: 'Naha', Lat: 26.21, Lng: 127.68, Who: 'Everyone' }],
    ]);
    const w = findConflicts(m, 0).filter((x) => x.kind === 'wrong-city');
    expect(w).toHaveLength(1);
    expect(w[0].message).toContain('Otaru');
  });

  it('flags cancellation deadlines in the next 72 hours only', () => {
    const m = setup([
      ['Reservations', { ID: 'R-dl', Date: '2030-03-06', Time: '18:30', Name: 'Sushi', City: 'Otaru', Who: 'Everyone', 'Cancellation deadline': '2030-03-04 18:30' }],
    ]);
    const at = (iso, t) => findConflicts(m, jstToMs(iso, t)).filter((x) => x.kind === 'deadline').length;
    expect(at('2030-03-01', '18:00')).toBe(0); // 72.5 h before
    expect(at('2030-03-01', '19:00')).toBe(1);
    expect(at('2030-03-04', '18:00')).toBe(1);
    expect(at('2030-03-04', '19:00')).toBe(0); // passed
  });
});
