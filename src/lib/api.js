// Talks to the Apps Script web app. Requests are POSTs with a text/plain body
// so the browser sends them without a CORS preflight (Apps Script can't answer one).

const CONFIG_KEY = 'trip.config.v1';

/** The Sheet's web app address, built into the published app (GitHub variable TRIP_SCRIPT_URL) so people sign in with just email and PIN. */
export const BUILT_IN_URL = (import.meta.env && import.meta.env.VITE_SCRIPT_URL) || '';

export function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {}; } catch { return {}; }
}
export function saveConfig(c) {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

export class ApiError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

export async function callApi(config, action, payload = {}, { timeoutMs = 45000 } = {}) {
  if (!config?.url) throw new ApiError('not_configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: config.token, ...payload }),
      redirect: 'follow',
      signal: ctrl.signal,
      cache: 'no-store',
    });
  } catch (e) {
    throw new ApiError('offline', 'Could not reach the Sheet');
  } finally {
    clearTimeout(timer);
  }
  let json;
  try { json = await res.json(); } catch { throw new ApiError('bad_response', `Unexpected reply (HTTP ${res.status}). Check the Apps Script URL.`); }
  if (!json.ok) {
    const err = new ApiError(json.error || 'error', json.message);
    err.minutes = json.minutes;
    throw err;
  }
  return json;
}

/** A short label for this device, shown to the administrator ("iPhone · Safari"). */
export function deviceLabel(ua = navigator.userAgent) {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Other';
  const br = /CriOS|Chrome\//.test(ua) && !/Edg/.test(ua) ? 'Chrome' : /Edg/.test(ua) ? 'Edge' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${br}`;
}

/** PIN rules, the same as the server's, so problems show before anything is sent. */
export function pinProblem(pin, min = 6) {
  if (!new RegExp(`^\\d{${min},12}$`).test(pin)) return `Use ${min} to 12 digits.`;
  if (/^(\d)\1+$/.test(pin) || '01234567890123456789'.includes(pin) || '98765432109876543210'.includes(pin)) return 'Too easy to guess. Avoid repeats and runs like 123456.';
  return null;
}

/** A random PIN that passes the rules, for the administrator to hand out. */
export function randomPin(len = 6) {
  for (;;) {
    const a = new Uint32Array(len);
    crypto.getRandomValues(a);
    const pin = [...a].map((x) => x % 10).join('');
    if (!pinProblem(pin, len)) return pin;
  }
}

/** Accepts the Apps Script URL itself, or a family invite link that contains it (…#setup=…). */
export function scriptUrlFrom(text) {
  const s = String(text || '').trim();
  const m = s.match(/#setup=([^&\s]+)/);
  return m ? decodeURIComponent(m[1]) : s;
}

/** Parses "35.01, 135.76" or a full Google Maps link locally; short links need the server. */
export function parseLocation(text) {
  let s = String(text || '').trim();
  try { s = decodeURIComponent(s); } catch { /* keep as is */ }
  const pats = [
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /[?&](?:q|query|ll|center|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
    /^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/,
  ];
  for (const p of pats) {
    const m = s.match(p);
    if (m) {
      const lat = +m[1], lng = +m[2];
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
    }
  }
  return null;
}

export const ERROR_TEXT = {
  offline: 'Offline. Changes are saved on this phone and will sync when you are back online.',
  bad_login: 'That email and PIN don’t match. Check both and try again.',
  account_locked: 'Too many wrong PINs. Try again in 15 minutes, or ask the trip organizer.',
  account_disabled: 'This account is blocked after too many wrong PINs. Ask the trip organizer to reset your PIN.',
  bad_session: 'You were signed out. Sign in again.',
  revoked: 'You were signed out because your access changed (for example a PIN reset) or was removed, so this device’s copy of the trip was erased. Sign in again, or ask the trip organizer.',
  access_not_set: 'The app has no administrator yet. In the Sheet, use Trip app → Set up the administrator.',
  not_admin: 'Only the administrator can do that.',
  pin_format: 'A PIN must be 6 to 12 digits (8 to 12 for the administrator).',
  pin_too_simple: 'That PIN is too easy to guess. Avoid repeats and runs like 123456.',
  pin_unchanged: 'The new PIN must be different from the current one.',
  bad_current_pin: 'Your current PIN is not right.',
  email_exists: 'Someone with that email already has access.',
  bad_email: 'Enter a valid email address.',
  bad_name: 'Enter a name.',
  no_such_user: 'No one with that email has access.',
  child_no_account: 'Children don’t get their own sign-in; their parents add and change things for them.',
  admin_from_sheet: 'The administrator account is managed from the Sheet’s Trip app menu.',
  not_configured: 'Not connected to the Sheet yet.',
  bad_trip_dates: 'Pick a first and a last day, with the last day on or after the first.',
  ai_not_set: 'Reading bookings is not turned on yet. The trip organizer turns it on in the Sheet: Trip app → Set the Claude API key.',
  ai_limit: 'You have read the most documents allowed for today. Try again tomorrow, or add the booking by hand.',
  ai_refused: 'Claude declined to read this. Add the booking by hand instead.',
  ai_key_bad: 'The Claude API key in the Sheet is not working. Ask the trip organizer to set it again.',
  ai_busy: 'Claude is busy right now. Try again in a minute.',
  ai_unreachable: 'The Sheet could not reach Claude. Try again in a minute.',
  ai_failed: 'Claude could not read that.',
  file_too_big: 'That file is too big. Files up to 8 MB work; try a screenshot of the important page.',
  file_type: 'That kind of file can’t be read. Use a PDF, a photo or screenshot, or paste the text.',
  nothing_to_read: 'Paste some text or choose a file first.',
  bad_response: 'The Sheet sent an unexpected reply. Check the Apps Script URL in Settings.',
  server_error: 'The Sheet reported an error.',
};
