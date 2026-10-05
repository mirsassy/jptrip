// A small in-memory stand-in for the Apps Script services Code.gs uses, so the
// real Code.gs can run under Node for tests and for the local mock server.
// It mimics how Sheets parses typed text (dates, times, numbers) closely enough
// for round-trip tests; it is not a full emulation.
import fs from 'node:fs';
import vm from 'node:vm';
import nodeCrypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function tzParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

/** Date for a wall-clock time in a time zone. */
export function zoned(y, m, d, h = 0, mi = 0, tz = 'America/Los_Angeles') {
  let t = Date.UTC(y, m - 1, d, h, mi);
  for (let i = 0; i < 3; i++) {
    const p = tzParts(new Date(t), tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
    t += Date.UTC(y, m - 1, d, h, mi) - asUtc;
  }
  return new Date(t);
}

const pad = (n) => String(n).padStart(2, '0');

class FakeRange {
  constructor(sheet, row, col, nr = 1, nc = 1) { Object.assign(this, { sheet, row, col, nr, nc }); }
  getSheet() { return this.sheet; }
  getRow() { return this.row; }
  getColumn() { return this.col; }
  getLastRow() { return this.row + this.nr - 1; }
  getNumColumns() { return this.nc; }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const row = [];
      for (let c = 0; c < this.nc; c++) {
        const v = this.sheet.cells[this.row - 1 + r]?.[this.col - 1 + c];
        row.push(v === undefined || v === null ? '' : v);
      }
      out.push(row);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(vals) {
    vals.forEach((row, r) => row.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)));
    return this;
  }
  setValue(v) {
    for (let r = 0; r < this.nr; r++) for (let c = 0; c < this.nc; c++) this.sheet.set(this.row + r, this.col + c, v);
    return this;
  }
  setNumberFormat(f) {
    for (let r = 0; r < this.nr; r++) for (let c = 0; c < this.nc; c++) this.sheet.formats.set(`${this.row + r},${this.col + c}`, f);
    return this;
  }
  copyTo(dest, opts) {
    if (!opts || !opts.formatOnly) throw new Error('fake copyTo supports formatOnly only');
    for (let c = 0; c < this.nc; c++) {
      const f = this.sheet.formats.get(`${this.row},${this.col + c}`);
      const key = `${dest.row},${dest.col + c}`;
      if (f) dest.sheet.formats.set(key, f); else dest.sheet.formats.delete(key);
    }
  }
}

class FakeSheet {
  constructor(ss, name, rows) {
    this.ss = ss;
    this.name = name;
    this.cells = rows.map((r) => r.slice());
    this.formats = new Map();
  }
  getName() { return this.name; }
  getLastRow() {
    for (let r = this.cells.length - 1; r >= 0; r--) {
      if ((this.cells[r] || []).some((v) => v !== '' && v !== null && v !== undefined)) return r + 1;
    }
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.cells.forEach((row) => row.forEach((v, c) => { if (v !== '' && v !== null && v !== undefined) max = Math.max(max, c + 1); }));
    return max;
  }
  getRange(row, col, nr, nc) { return new FakeRange(this, row, col, nr, nc); }
  set(row, col, v) {
    while (this.cells.length < row) this.cells.push([]);
    const r = this.cells[row - 1];
    while (r.length < col) r.push('');
    r[col - 1] = this.parse(v, this.formats.get(`${row},${col}`));
  }
  /** Mimics how Sheets interprets typed text. */
  parse(v, fmt) {
    if (typeof v !== 'string' || fmt === '@') return v;
    if (v.startsWith("'")) return v.slice(1); // leading apostrophe: stored as text
    if (v.startsWith('=')) return { formula: v };
    const tz = this.ss.tz;
    let m;
    if ((m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return zoned(+m[1], +m[2], +m[3], 0, 0, tz);
    if ((m = v.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/))) return zoned(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
    if ((m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return zoned(+m[3], +m[1], +m[2], 0, 0, tz);
    if ((m = v.match(/^(\d{1,2}):(\d{2})$/))) return zoned(1899, 12, 30, +m[1], +m[2], tz);
    if (/^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
    return v;
  }
  toObjects() { return this.cells; }
}

class FakeSpreadsheet {
  constructor(tabs, tz) {
    this.tz = tz;
    this.sheets = Object.fromEntries(Object.entries(tabs).map(([n, rows]) => [n, new FakeSheet(this, n, rows)]));
  }
  getSheetByName(n) { return this.sheets[n] || null; }
  getSpreadsheetTimeZone() { return this.tz; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/FAKE/edit'; }
  toast() {}
}

/**
 * A made-up trip in the same shape as the real Sheet (tabs, headers, conventions).
 * The names, places and dates are fictional; the real trip lives only in the private Sheet.
 * It deliberately includes an unbooked night (Mar 11) and a region instead of a city (Okinawa).
 */
export function seedTabs(tz = 'America/Los_Angeles') {
  const d = (m, day) => zoned(2030, m, day, 0, 0, tz);
  return {
    'How to use': [['How this workbook works']],
    People: [
      ['Name', 'Adult or child', 'Group', 'Color (hex)', 'Notes'],
      ['Avery', 'Adult', 'Avery family', '#1F77B4'], ['Blake', 'Adult', 'Avery family', '#FF7F0E'],
      ['Casey', 'Adult', 'Casey and Drew', '#2CA02C'], ['Drew', 'Adult', 'Casey and Drew', '#D62728'],
      ['Emery', 'Adult', '', '#9467BD'], ['Frankie', 'Adult', '', '#8C564B'], ['Gale', 'Adult', '', '#E377C2'],
      ['Kit', 'Child', 'Avery family', '#17BECF', 'Age 7'], ['Robin', 'Child', 'Avery family', '#BCBD22', 'Age 3'],
    ],
    Stays: [
      ['Check-in', 'Check-out', 'City', 'Hotel', 'Address', 'Who', 'Status', 'Notes', 'Confirmation #', 'ID', 'Lat', 'Lng', 'Last edited by'],
      [d(3, 4), d(3, 5), 'Sapporo', '', '', 'Everyone', 'Tentative'],
      [d(3, 5), d(3, 8), 'Otaru', '', '', 'Everyone', 'Tentative'],
      [d(3, 8), d(3, 10), 'Hakodate', '', '', 'Everyone', 'Tentative'],
      [d(3, 10), d(3, 11), 'Sendai', '', '', 'Everyone', 'Tentative'],
      [d(3, 12), d(3, 15), 'Nikko', '', '', 'Everyone', 'Tentative', 'Night of Mar 11 not yet assigned.'],
      [d(3, 15), d(3, 18), 'Kamakura', '', '', 'Everyone', 'Tentative'],
      [d(3, 18), d(3, 21), 'Yokohama', '', '', 'Everyone', 'Tentative'],
      [d(3, 21), d(3, 27), 'Okinawa', '', '', 'Everyone', 'Tentative', 'Islands not yet chosen.'],
    ],
    Transport: [['Date', 'Depart', 'Arrive', 'Mode', 'From', 'To', 'Carrier / train', 'Who', 'Seats', 'Confirmation #', 'Status', 'Notes', 'ID', 'From Lat', 'From Lng', 'To Lat', 'To Lng', 'Last edited by']],
    Reservations: [['Date', 'Time', 'Type', 'Name', 'City', 'Address', 'Who', 'Party size', 'Cancellation deadline', 'Kid-friendly', 'Confirmation #', 'Status', 'Link', 'Notes', 'ID', 'Lat', 'Lng', 'Last edited by']],
    Ideas: [['Name', 'City', 'Area', 'Type', 'Category', 'Michelin', 'Price', 'Kid-friendly', 'Best for', 'Reservation', 'Timing / closed days', 'Address', 'Source', 'Verification', 'Status', 'Notes', 'ID', 'Lat', 'Lng', 'Last edited by']],
    Notes: [['Date', 'City', 'Who', 'Note', 'ID', 'Last edited by']],
    Lists: [
      ['Status', 'City', 'Mode', 'Reservation type', 'Yes/No', 'City Lat', 'City Lng'],
      ['Idea', 'Sapporo', 'Flight', 'Restaurant', 'Yes', 43.0687, 141.3508],
      ['Tentative', 'Otaru', 'Shinkansen', 'Activity', 'No', 43.1977, 140.9937],
      ['Confirmed', 'Hakodate', 'Limited express', 'Tour', 'Unsure', 41.7738, 140.7262],
      ['Cancelled', 'Sendai', 'Local train', 'Onsen', '', 38.2601, 140.8824],
      ['', 'Nikko', 'Bus', 'Other', '', 36.7494, 139.6203],
      ['', 'Kamakura', 'Car', '', '', 35.3192, 139.5505],
      ['', 'Yokohama', 'Taxi', '', '', 35.4658, 139.6223],
      ['', 'Okinawa', 'Ferry', '', '', 26.2125, 127.6792],
      ['', '', 'Walk'],
    ],
  };
}

/**
 * Accounts for the fictional family, used in tests and by the local mock server.
 * Avery is the administrator; Casey has already chosen a PIN; Blake signs in for the first time.
 * Kit and Robin are children: they have no accounts.
 */
export const TEST_USERS = {
  admin: { email: 'avery@example.com', name: 'Avery', pin: '24681357' },
  casey: { email: 'casey@example.com', name: 'Casey', pin: '135792' },
  blake: { email: 'blake@example.com', name: 'Blake', pin: '864209' },
};

/** Deterministic fake geocoder: a point near the matching Lists city, or Tokyo. */
function fakeGeocode(q, ss) {
  if (/nowhere/i.test(q)) return { status: 'ZERO_RESULTS', results: [] };
  const lists = ss.getSheetByName('Lists').cells;
  let base = [35.6812, 139.7671];
  for (const row of lists.slice(1)) {
    if (row[1] && typeof row[5] === "number" && q.toLowerCase().includes(String(row[1]).toLowerCase())) base = [row[5], row[6]];
  }
  let h = 0;
  for (const ch of q) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const lat = base[0] + ((h % 1000) - 500) / 100000;
  const lng = base[1] + (((h >> 10) % 1000) - 500) / 100000;
  return { status: 'OK', results: [{ geometry: { location: { lat, lng } } }] };
}

const json = (code, obj) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(obj), getHeaders: () => ({}) });

/**
 * Stand-in for the Claude Messages API. It answers from the pasted text so tests can
 * steer it: "REFUSE" -> a refusal, "BADKEY" -> 401, "NOTHING" -> no items;
 * anything else -> a fictional hotel stay and a flight.
 */
export const FAKE_CLAUDE_ITEMS = [
  { kind: 'stay', status: 'Confirmed', name: 'Harbor View Hotel', date: '2030-03-05', end_date: '2030-03-08', time: '', end_time: '', city: 'Otaru', address: '1-2-3 Ironai, Otaru', from: '', to: '', mode: '', reservation_type: '', seats: '', confirmation: 'HV-0042', party_size: '4', guests: ['Avery Example', 'Kit'], cancellation_deadline: '2030-03-03 18:00', link: '', notes: 'Two rooms, breakfast included' },
  { kind: 'transport', status: 'Confirmed', name: 'Air Example 123', date: '2030-03-04', end_date: '', time: '09:10', end_time: '10:40', city: '', address: '', from: 'Haneda Airport', to: 'Sapporo', mode: 'flight', reservation_type: '', seats: '12A-12D', confirmation: 'QX7Z9P', party_size: '', guests: ['Casey Example', 'Drew Example', 'Pat Stranger'], cancellation_deadline: '', link: '', notes: '' },
];
function fakeClaude(opts, calls) {
  const body = JSON.parse(opts.payload);
  calls.claude.push({ headers: opts.headers, body });
  const prompt = body.messages[0].content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  if (/BADKEY/.test(prompt)) return json(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
  if (/REFUSE/.test(prompt)) return json(200, { stop_reason: 'refusal', content: [] });
  const out = /NOTHING/.test(prompt) ? { items: [], warnings: ['No bookings found.'] } : { items: FAKE_CLAUDE_ITEMS, warnings: ['Check the flight time zone.'] };
  return json(200, { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(out) }] });
}

export function createGas({ tz = 'America/Los_Angeles', tabs = seedTabs(tz), users = TEST_USERS } = {}) {
  const ss = new FakeSpreadsheet(tabs, tz);
  const props = new Map();
  const cache = new Map();
  const calls = { geocode: 0, claude: [] };
  const ctx = {
    console,
    SpreadsheetApp: { getActive: () => ss, getUi: () => { throw new Error('no ui'); } },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => props.get(k) ?? null,
        setProperty: (k, v) => { if (String(v).length > 9 * 1024) throw new Error('Argument too large: value'); props.set(k, String(v)); },
        setProperties: (obj) => Object.entries(obj).forEach(([k, v]) => { if (String(v).length > 9 * 1024) throw new Error('Argument too large: value'); props.set(k, String(v)); }),
        getProperties: () => Object.fromEntries(props),
        getKeys: () => [...props.keys()],
        deleteProperty: (k) => props.delete(k),
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k),
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ text: s, setMimeType() { return this; }, getContent() { return s; } }),
    },
    Utilities: {
      formatDate(date, zone, pattern) {
        const p = tzParts(date, zone);
        return pattern.replace('yyyy', p.y).replace('MM', pad(p.m)).replace('dd', pad(p.d)).replace('HH', pad(p.h)).replace('mm', pad(p.mi));
      },
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, str) => [...nodeCrypto.createHash(alg).update(str, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
      base64Encode: (bytes) => Buffer.from(bytes.map((b) => b & 255)).toString('base64'),
      sleep() {},
      base64EncodeWebSafe: (s) => Buffer.from(s).toString('base64url'),
      base64Decode: (s) => {
        if (!/^[A-Za-z0-9+/=\s]*$/.test(s)) throw new Error('Could not decode string.');
        return [...Buffer.from(s, 'base64')].map((b) => (b > 127 ? b - 256 : b));
      },
      newBlob: (data, type, name) => {
        const bytes = typeof data === 'string' ? [...Buffer.from(data)] : data;
        return { type, name, getBytes: () => bytes };
      },
    },
    Maps: { newGeocoder: () => ({ setRegion() { return this; }, setLanguage() { return this; }, geocode: (q) => { calls.geocode++; return fakeGeocode(q, ss); } }) },
    UrlFetchApp: {
      fetch(url, opts = {}) {
        if (url.startsWith('https://maps.app.goo.gl/')) {
          return { getHeaders: () => ({ Location: 'https://www.google.com/maps/place/Kinkaku-ji/@35.0394,135.7292,17z' }), getContentText: () => '' };
        }
        if (url === 'https://api.anthropic.com/v1/messages') return fakeClaude(opts, calls);
        return { getHeaders: () => ({}), getContentText: () => '' };
      },
    },
    Session: { getActiveUser: () => ({ getEmail: () => '' }) },
    ScriptApp: { getProjectTriggers: () => [], getOAuthToken: () => 'fake-oauth-token' },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(here, '../apps-script/Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  if (users?.admin) ctx.setupAdmin_(users.admin.email, users.admin.name, users.admin.pin);
  if (users?.casey) ctx.addMember_(users.casey.email, users.casey.name, users.casey.pin, false);
  if (users?.blake) ctx.addMember_(users.blake.email, users.blake.name, users.blake.pin, true);

  function post(body) {
    const out = ctx.doPost({ postData: { contents: JSON.stringify(body) } });
    return JSON.parse(out.getContent());
  }
  /** Signs in and returns a session token. */
  function login(user = users.admin) {
    const r = post({ action: 'login', email: user.email, pin: user.pin });
    if (!r.ok) throw new Error(`login failed: ${r.error}`);
    return r.token;
  }
  return { ss, ctx, post, login, props, cache, calls };
}
