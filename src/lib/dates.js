// Dates are plain 'YYYY-MM-DD' strings and times 'HH:mm', always Japan local
// time as typed in the Sheet. Japan has no daylight saving, so Japan time is
// always UTC+9 and arithmetic on these strings is safe.

const JST_OFFSET_MS = 9 * 3600 * 1000;
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');

export function isoFromParts(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Accepts 2030-03-07, 2030-03-07 18:30, 3/7/2030, 3/7 (year from `fallbackYear`), Mar 7 2030. */
export function parseDate(v, fallbackYear) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return valid(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/))) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : fallbackYear;
    return y ? valid(y, +m[1], +m[2]) : null;
  }
  if ((m = s.match(/^(?:[A-Za-z]{3},?\s+)?([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/))) {
    const mo = MONTHS[m[1].toLowerCase()];
    const y = m[3] ? +m[3] : fallbackYear;
    return mo && y ? valid(y, mo, +m[2]) : null;
  }
  return null;
}

function valid(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return isoFromParts(y, m, d);
}

/** Accepts 18:30, 9:05, 18:30:00, 6:30 PM, and the time part of 2030-03-07 18:30. */
export function parseTime(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  const m = s.match(/(?:^|\s)(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?\s*$/) || s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let h = +m[1];
  const mi = +m[2];
  if (m[3]) {
    const pm = /p/i.test(m[3]);
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  if (h > 23 || mi > 59) return null;
  return `${pad(h)}:${pad(mi)}`;
}

export function toMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function fromMinutes(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return isoFromParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function diffDays(a, b) {
  const ms = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((ms(b) - ms(a)) / 86400000);
}

/** Inclusive list of dates from a to b. */
export function daysBetween(a, b) {
  const out = [];
  if (!a || !b) return out;
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Milliseconds since epoch for a Japan-local date and time. */
export function jstToMs(date, time = '00:00') {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h, mi) - JST_OFFSET_MS;
}

/** Current Japan date and time. */
export function jpNow(ms = Date.now()) {
  const dt = new Date(ms + JST_OFFSET_MS);
  return {
    ms,
    date: isoFromParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()),
    time: `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`,
  };
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Thu, Mar 7" */
export function fmtDay(iso, { year = false } = {}) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dow = DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dow}, ${MON[m - 1]} ${d}${year ? `, ${y}` : ''}`;
}

/** "Mar 7" */
export function fmtShort(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-').map(Number);
  return `${MON[m - 1]} ${d}`;
}

/** Japan time of a timestamp, e.g. "Mar 7, 14:05 JST". */
export function fmtJstStamp(ms) {
  if (!ms) return 'never';
  const n = jpNow(ms);
  return `${fmtShort(n.date)}, ${n.time} JST`;
}

/** "5 min ago" style, for the last-synced label. */
export function ago(ms, now = Date.now()) {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
