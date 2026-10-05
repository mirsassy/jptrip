/**
 * Trip planner: read/write API for the trip Sheet.
 *
 * Deploy as a web app bound to the Sheet (see SETUP.md). Every request is a
 * POST with a JSON body sent as text/plain (this avoids a CORS preflight,
 * which Apps Script cannot answer).
 *
 * Access: each person signs in with their email and PIN and gets a random
 * session token; every other request carries that token. There is exactly one
 * administrator, set up from the Sheet's "Trip app" menu (so only the Sheet
 * owner can create it); the administrator adds and removes everyone else from
 * the app. PINs and tokens are stored only as SHA-256 hashes in Script Properties.
 *
 * Permissions (appsscript.json): this spreadsheet only, and outside requests (Claude,
 * short map links). Uploaded files are read, never stored.
 *
 * @OnlyCurrentDoc  Limits this script to the spreadsheet it is attached to.
 */

var TABS = {
  'People': { key: 'Name' },
  'Stays': { key: 'ID', prefix: 'S' },
  'Transport': { key: 'ID', prefix: 'T' },
  'Reservations': { key: 'ID', prefix: 'R' },
  'Ideas': { key: 'ID', prefix: 'I' },
  'Notes': { key: 'ID', prefix: 'N' }
};
var LISTS_TAB = 'Lists';

var DATE_COLS = ['Check-in', 'Check-out', 'Date'];
var TIME_COLS = ['Depart', 'Arrive', 'Time'];
var DATETIME_COLS = ['Cancellation deadline'];
var NUMBER_COLS = ['Lat', 'Lng', 'From Lat', 'From Lng', 'To Lat', 'To Lng', 'City Lat', 'City Lng', 'Party size'];

// Where to geocode from, per tab. Each target names the lat/lng columns and
// the columns that make up the search text (first non-empty "address" wins,
// otherwise the "name" columns joined).
var GEO = {
  'Stays': [{ lat: 'Lat', lng: 'Lng', address: 'Address', name: ['Hotel', 'City'], needName: 'Hotel' }],
  'Reservations': [{ lat: 'Lat', lng: 'Lng', address: 'Address', name: ['Name', 'City'], needName: 'Name' }],
  'Ideas': [{ lat: 'Lat', lng: 'Lng', address: 'Address', name: ['Name', 'Area', 'City'], needName: 'Name' }],
  'Transport': [
    { lat: 'From Lat', lng: 'From Lng', name: ['From'], needName: 'From', skipIfCity: 'From' },
    { lat: 'To Lat', lng: 'To Lng', name: ['To'], needName: 'To', skipIfCity: 'To' }
  ]
};

// PINs are short, so guessing is limited per account: after LOCK_AFTER wrong PINs in a
// row the account is locked for LOCK_MINUTES; after DISABLE_AFTER it stays blocked until
// the administrator resets the PIN. At most 10 guesses per reset against 1,000,000+ PINs.
var PIN_MIN = 6;
var ADMIN_PIN_MIN = 8;
var PIN_MAX = 12;
var LOCK_AFTER = 5;
var LOCK_MINUTES = 15;
var DISABLE_AFTER = 10;
var WRONG_PIN_DELAY_MS = 1500;
var MAX_SESSIONS = 5;          // per person (phones/browsers signed in at once)
var SESSION_IDLE_DAYS = 30;    // a phone unused this long must sign in again

// Reading bookings with Claude (optional; needs an Anthropic API key set from the Sheet menu).
// The key stays in Script Properties: it is never sent to the app.
var CLAUDE_MODEL = 'claude-opus-5-5';
var CLAUDE_DAILY_LIMIT = 40;              // documents read per person per day
var UPLOAD_MAX_BYTES = 8 * 1024 * 1024;   // largest file the app may upload
var TEXT_MAX_CHARS = 100000;              // longest pasted text
var CLAUDE_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/* ------------------------------------------------------------------ */
/* Web app entry points                                                */
/* ------------------------------------------------------------------ */

function doGet() {
  return json_({ ok: true, app: 'japan-trip', note: 'POST JSON to use this API.' });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }
  try {
    if (req.action === 'login') return json_(withLock_(function () { return login_(req.email, req.pin, req.device); }));

    var auth = withLock_(function () { return authSession_(req.token); });
    if (auth.error) return json_({ ok: false, error: auth.error });
    var me = auth.user;
    var editor = me.name; // "Last edited by" comes from the signed-in account, not from anything the app claims

    if (req.action.indexOf('admin') === 0 && me.role !== 'admin') return json_({ ok: false, error: 'not_admin' });

    switch (req.action) {
      case 'ping':
        return json_({ ok: true });
      case 'read':
        // Fast: no map lookups here (the 15-minute trigger and saves do those); rows only get missing IDs
        return json_({ ok: true, me: publicUser_(me), data: readAll_({ fillIds: true }) });
      case 'upsert':
        return json_(withLock_(function () {
          var row = upsert_(req.tab, req.key, req.values || {}, editor);
          return { ok: true, row: row, data: readAll_() };
        }));
      case 'moveIdea':
        return json_(withLock_(function () {
          moveIdea_(req.ideaId, req.reservation || {}, editor);
          return { ok: true, data: readAll_() };
        }));
      case 'addListValue':
        return json_(withLock_(function () {
          addListValue_(req.column, req.value, req.extra || {});
          return { ok: true, data: readAll_() };
        }));
      case 'resolveLocation':
        return json_({ ok: true, location: resolveLocation_(String(req.text || '')) });
      case 'extract':
        return json_(extract_(req, me));
      case 'changePin':
        return json_(withLock_(function () { return changePin_(me.email, req.currentPin, req.newPin, auth.tokenHash); }));
      case 'logout':
        return json_(withLock_(function () { return logout_(me.email, auth.tokenHash); }));
      case 'adminListUsers':
        return json_({ ok: true, users: loadUsers_().map(publicUser_) });
      case 'adminAddUser':
        return json_(withLock_(function () { return adminAddUser_(req.email, req.name, req.pin); }));
      case 'adminResetPin':
        return json_(withLock_(function () { return adminResetPin_(req.email, req.pin); }));
      case 'adminUnlock':
        return json_(withLock_(function () { return adminUnlock_(req.email); }));
      case 'adminSetTripDates':
        return json_(withLock_(function () { return setTripDates_(req.start, req.end); }));
      case 'adminRemoveUser':
        return json_(withLock_(function () { return adminRemoveUser_(req.email); }));
      default:
        return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return json_({ ok: false, error: 'server_error', message: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ */
/* Accounts: email + PIN, one administrator, session tokens            */
/* ------------------------------------------------------------------ */

// Each account is its own Script Property ("USER:<email>"): a property value is limited
// to 9 KB, and an account with several signed-in devices is about 1 KB.
function loadUsers_() {
  var all = PropertiesService.getScriptProperties().getProperties();
  var users = [];
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('USER:') !== 0) return;
    try { users.push(JSON.parse(all[k])); } catch (err) { /* skip a damaged entry */ }
  });
  return users.sort(function (a, b) {
    return (a.role === 'admin' ? 0 : 1) - (b.role === 'admin' ? 0 : 1) || String(a.created).localeCompare(String(b.created));
  });
}

function saveUsers_(users) {
  var props = PropertiesService.getScriptProperties();
  var keep = {};
  users.forEach(function (u) { keep['USER:' + u.email] = JSON.stringify(u); });
  props.getKeys().forEach(function (k) { if (k.indexOf('USER:') === 0 && !(k in keep)) props.deleteProperty(k); });
  props.setProperties(keep, false);
}

function normEmail_(e) { return String(e || '').trim().toLowerCase(); }

function findUser_(users, email) {
  var e = normEmail_(email);
  for (var i = 0; i < users.length; i++) if (users[i].email === e) return users[i];
  return null;
}

function sha256_(s) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
}

function hashPin_(pin, salt) { return sha256_('pin:' + salt + ':' + String(pin)); }
function hashToken_(token) { return sha256_('session:' + String(token)); }

function newToken_() {
  return (Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

/** Returns an error code, or null when the PIN is acceptable. */
function pinProblem_(pin, min) {
  pin = String(pin || '');
  if (!new RegExp('^\\d{' + min + ',' + PIN_MAX + '}$').test(pin)) return 'pin_format';
  if (/^(\d)\1+$/.test(pin)) return 'pin_too_simple';
  var asc = '01234567890123456789', desc = '98765432109876543210';
  if (asc.indexOf(pin) >= 0 || desc.indexOf(pin) >= 0) return 'pin_too_simple';
  return null;
}

function setPin_(user, pin) {
  user.salt = Utilities.getUuid();
  user.pinHash = hashPin_(pin, user.salt);
  user.failures = 0;
  user.lockedUntil = 0;
  user.disabled = false;
}

function publicUser_(u) {
  return {
    email: u.email, name: u.name, role: u.role, mustChangePin: !!u.mustChangePin,
    locked: (u.lockedUntil || 0) > Date.now(), disabled: !!u.disabled,
    created: u.created, lastSeen: u.lastSeen || '', devices: (u.sessions || []).length,
  };
}

function login_(email, pin, device) {
  var users = loadUsers_();
  if (!users.length) return { ok: false, error: 'access_not_set' };
  var u = findUser_(users, email);
  if (!u) { Utilities.sleep(WRONG_PIN_DELAY_MS); return { ok: false, error: 'bad_login' }; }
  if (u.disabled) return { ok: false, error: 'account_disabled' };
  if ((u.lockedUntil || 0) > Date.now()) return { ok: false, error: 'account_locked', minutes: Math.ceil((u.lockedUntil - Date.now()) / 60000) };
  if (hashPin_(pin, u.salt) !== u.pinHash) {
    u.failures = (u.failures || 0) + 1;
    if (u.failures >= DISABLE_AFTER) u.disabled = true;
    else if (u.failures % LOCK_AFTER === 0) u.lockedUntil = Date.now() + LOCK_MINUTES * 60000;
    saveUsers_(users);
    Utilities.sleep(WRONG_PIN_DELAY_MS);
    if (u.disabled) return { ok: false, error: 'account_disabled' };
    if (u.lockedUntil > Date.now()) return { ok: false, error: 'account_locked', minutes: LOCK_MINUTES };
    return { ok: false, error: 'bad_login' };
  }
  u.failures = 0;
  u.lockedUntil = 0;
  var token = newToken_();
  var now = new Date().toISOString();
  u.sessions = (u.sessions || []).concat([{ hash: hashToken_(token), created: now, lastUsed: now, device: String(device || '').slice(0, 80) }]);
  while (u.sessions.length > MAX_SESSIONS) u.sessions.shift(); // oldest sign-in drops off
  u.lastSeen = now;
  saveUsers_(users);
  return { ok: true, token: token, me: publicUser_(u) };
}

/** Finds the signed-in account for a session token. */
function authSession_(token) {
  var users = loadUsers_();
  if (!users.length) return { error: 'access_not_set' };
  if (!token) return { error: 'bad_session' };
  var h = hashToken_(token);
  var idleMs = SESSION_IDLE_DAYS * 86400000;
  for (var i = 0; i < users.length; i++) {
    var sessions = users[i].sessions || [];
    for (var j = 0; j < sessions.length; j++) {
      if (sessions[j].hash !== h) continue;
      if (users[i].disabled) return { error: 'bad_session' };
      var last = Date.parse(sessions[j].lastUsed) || 0;
      if (Date.now() - last > idleMs) {
        sessions.splice(j, 1);
        saveUsers_(users);
        return { error: 'bad_session' };
      }
      if (Date.now() - last > 3600000) { // record use at most hourly
        sessions[j].lastUsed = users[i].lastSeen = new Date().toISOString();
        saveUsers_(users);
      }
      return { user: users[i], tokenHash: h };
    }
  }
  Utilities.sleep(300);
  return { error: 'bad_session' };
}

function changePin_(email, currentPin, newPin, keepTokenHash) {
  var users = loadUsers_();
  var u = findUser_(users, email);
  if (hashPin_(currentPin, u.salt) !== u.pinHash) { Utilities.sleep(WRONG_PIN_DELAY_MS); return { ok: false, error: 'bad_current_pin' }; }
  var problem = pinProblem_(newPin, u.role === 'admin' ? ADMIN_PIN_MIN : PIN_MIN);
  if (problem) return { ok: false, error: problem };
  if (String(newPin) === String(currentPin)) return { ok: false, error: 'pin_unchanged' };
  setPin_(u, newPin);
  u.mustChangePin = false;
  // Other phones signed in with the old PIN are signed out; this one stays signed in
  u.sessions = (u.sessions || []).filter(function (x) { return x.hash === keepTokenHash; });
  saveUsers_(users);
  return { ok: true, me: publicUser_(u) };
}

function logout_(email, tokenHash) {
  var users = loadUsers_();
  var u = findUser_(users, email);
  if (u) u.sessions = (u.sessions || []).filter(function (x) { return x.hash !== tokenHash; });
  saveUsers_(users);
  return { ok: true };
}

function adminAddUser_(email, name, pin) {
  var users = loadUsers_();
  email = normEmail_(email);
  name = String(name || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'bad_email' };
  if (!name) return { ok: false, error: 'bad_name' };
  if (isChild_(name)) return { ok: false, error: 'child_no_account' };
  if (findUser_(users, email)) return { ok: false, error: 'email_exists' };
  var problem = pinProblem_(pin, PIN_MIN);
  if (problem) return { ok: false, error: problem };
  var u = { email: email, name: name, role: 'member', mustChangePin: true, created: new Date().toISOString(), sessions: [] };
  setPin_(u, pin);
  users.push(u);
  saveUsers_(users);
  return { ok: true, users: users.map(publicUser_) };
}

function adminResetPin_(email, pin) {
  var users = loadUsers_();
  var u = findUser_(users, email);
  if (!u) return { ok: false, error: 'no_such_user' };
  if (u.role === 'admin') return { ok: false, error: 'admin_from_sheet' };
  var problem = pinProblem_(pin, PIN_MIN);
  if (problem) return { ok: false, error: problem };
  setPin_(u, pin);
  u.mustChangePin = true;
  u.sessions = []; // signs them out everywhere; their phones erase the trip at next sync
  saveUsers_(users);
  return { ok: true, users: users.map(publicUser_) };
}

function adminUnlock_(email) {
  var users = loadUsers_();
  var u = findUser_(users, email);
  if (!u) return { ok: false, error: 'no_such_user' };
  u.failures = 0;
  u.lockedUntil = 0;
  u.disabled = false;
  saveUsers_(users);
  return { ok: true, users: users.map(publicUser_) };
}

function adminRemoveUser_(email) {
  var users = loadUsers_();
  var u = findUser_(users, email);
  if (!u) return { ok: false, error: 'no_such_user' };
  if (u.role === 'admin') return { ok: false, error: 'admin_from_sheet' };
  saveUsers_(users.filter(function (x) { return x !== u; }));
  return { ok: true, users: loadUsers_().map(publicUser_) };
}

/** The trip's first and last day as set by the administrator ({} when not set: the app uses the Sheet's dates). */
function tripDates_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('TRIP_DATES') || '{}'); } catch (err) { return {}; }
}

function setTripDates_(start, end) {
  var props = PropertiesService.getScriptProperties();
  if (!start && !end) { props.deleteProperty('TRIP_DATES'); return { ok: true, data: readAll_() }; }
  var iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(String(start)) || !iso.test(String(end)) || String(end) < String(start)) return { ok: false, error: 'bad_trip_dates' };
  props.setProperty('TRIP_DATES', JSON.stringify({ start: String(start), end: String(end) }));
  return { ok: true, data: readAll_() };
}

/** True when the People tab lists this name as a child. Children have no accounts; their parents act for them. */
function isChild_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName('People');
  if (!sh || sh.getLastRow() < 2) return false;
  var headers = headerRow_(sh);
  var n = headers.indexOf('Name'), c = headers.indexOf('Adult or child');
  if (n < 0 || c < 0) return false;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][n]).trim().toLowerCase() === String(name).trim().toLowerCase()) return String(rows[i][c]).trim().toLowerCase() === 'child';
  }
  return false;
}

/**
 * Creates or replaces THE administrator. Only reachable from the Sheet's menu,
 * i.e. by the Sheet owner. Any previous administrator account is removed.
 */
function setupAdmin_(email, name, pin) {
  email = normEmail_(email);
  name = String(name || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
  if (!name) return 'Enter a name.';
  var problem = pinProblem_(pin, ADMIN_PIN_MIN);
  if (problem) return 'The administrator PIN must be ' + ADMIN_PIN_MIN + '–' + PIN_MAX + ' digits and not a simple pattern like 12345678.';
  var users = loadUsers_().filter(function (x) { return x.role !== 'admin' && x.email !== email; });
  var u = { email: email, name: name, role: 'admin', mustChangePin: false, created: new Date().toISOString(), sessions: [] };
  setPin_(u, pin);
  users.unshift(u);
  saveUsers_(users);
  return null;
}

/** Adds a member directly (tests and the local mock use this; people normally add members in the app). */
function addMember_(email, name, pin, mustChangePin) {
  var r = adminAddUser_(email, name, pin);
  if (r.ok && mustChangePin === false) {
    var users = loadUsers_();
    findUser_(users, email).mustChangePin = false;
    saveUsers_(users);
  }
  return r;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

function readAll_(opts) {
  var ss = SpreadsheetApp.getActive();
  var tz = ss.getSpreadsheetTimeZone();
  var out = { tabs: {}, lists: readLists_(ss), serverTime: new Date().toISOString(), sheetUrl: ss.getUrl(), trip: tripDates_() };
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var t = readTab_(sh, tz);
    if (opts && opts.fillIds) fillIds_(name, sh, t);
    out.tabs[name] = { headers: t.headers, rows: t.rows };
  });
  return out;
}

/** Gives rows typed or pasted into the Sheet (e.g. by another tool) an ID, so the app can edit them in place. */
function fillIds_(tab, sh, t) {
  var cfg = TABS[tab];
  if (!cfg.prefix) return;
  var col = ensureKeyCol_(sh, t.headers, cfg.key);
  var missing = t.rows.filter(function (r) { return !r.ID; });
  if (!missing.length) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return;
  try {
    missing.forEach(function (r) {
      if (String(sh.getRange(r._row, col + 1).getValue()).trim()) return; // filled meanwhile
      r.ID = newId_(cfg.prefix);
      sh.getRange(r._row, col + 1).setValue(r.ID);
    });
  } finally {
    lock.releaseLock();
  }
}

function readTab_(sh, tz) {
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastCol < 1) return { headers: [], rows: [] };
  var values = sh.getRange(1, 1, Math.max(lastRow, 1), lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var obj = {};
    var any = false;
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      var v = toPlain_(values[r][c], headers[c], tz);
      if (v !== '') any = true;
      obj[headers[c]] = v;
    }
    if (any) {
      obj._row = r + 1;
      rows.push(obj);
    }
  }
  return { headers: headers, rows: rows };
}

/** Converts a cell value to a plain JSON value. Dates become Japan-wall-clock strings as typed. */
function toPlain_(v, header, tz) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    if (TIME_COLS.indexOf(header) >= 0 || v.getFullYear() < 1900) {
      return Utilities.formatDate(v, tz, 'HH:mm');
    }
    if (DATE_COLS.indexOf(header) >= 0) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    var hm = Utilities.formatDate(v, tz, 'HH:mm');
    if (hm === '00:00' && DATETIME_COLS.indexOf(header) < 0) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm');
  }
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return String(v).trim();
}

function readLists_(ss) {
  var sh = ss.getSheetByName(LISTS_TAB);
  if (!sh || sh.getLastColumn() < 1) return { columns: {}, cities: [] };
  var values = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), sh.getLastColumn()).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var columns = {};
  headers.forEach(function (h, c) {
    if (!h) return;
    columns[h] = [];
    for (var r = 1; r < values.length; r++) {
      var v = values[r][c];
      if (v !== '' && v !== null) columns[h].push(typeof v === 'number' ? v : String(v).trim());
    }
  });
  var cities = [];
  var ci = headers.indexOf('City');
  var la = headers.indexOf('City Lat');
  var ln = headers.indexOf('City Lng');
  if (ci >= 0) {
    for (var r2 = 1; r2 < values.length; r2++) {
      var name = String(values[r2][ci] || '').trim();
      if (!name) continue;
      var lat = la >= 0 ? Number(values[r2][la]) : NaN;
      var lng = ln >= 0 ? Number(values[r2][ln]) : NaN;
      cities.push({ name: name, lat: isFinite(lat) && values[r2][la] !== '' ? lat : null, lng: isFinite(lng) && values[r2][ln] !== '' ? lng : null });
    }
  }
  return { columns: columns, cities: cities };
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Updates the row whose key column equals `key`, or appends a new row.
 * Only the columns present in `values` are written, so two people editing
 * different fields of the same row do not overwrite each other.
 */
function upsert_(tab, key, values, editor) {
  var cfg = TABS[tab];
  if (!cfg) throw new Error('Unknown tab: ' + tab);
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(tab);
  var tz = ss.getSpreadsheetTimeZone();
  var headers = headerRow_(sh);
  var keyCol = ensureKeyCol_(sh, headers, cfg.key);

  if (cfg.prefix && !values[cfg.key] && !key) values[cfg.key] = newId_(cfg.prefix);
  var lookup = key || values[cfg.key];
  var rowIdx = lookup ? findRow_(sh, keyCol, lookup) : -1;
  if (rowIdx < 0) {
    rowIdx = Math.max(sh.getLastRow(), 1) + 1;
    if (rowIdx > 2) {
      sh.getRange(rowIdx - 1, 1, 1, headers.length).copyTo(sh.getRange(rowIdx, 1, 1, headers.length), { formatOnly: true });
    }
    if (cfg.prefix && !values[cfg.key]) values[cfg.key] = newId_(cfg.prefix);
  }

  if (headers.indexOf('Last edited by') >= 0 && editor) values['Last edited by'] = String(editor);

  // If a location-defining field changed and no coordinates were given, clear the old ones so they get re-geocoded.
  (GEO[tab] || []).forEach(function (g) {
    var touched = [g.address].concat(g.name).some(function (f) { return f && Object.prototype.hasOwnProperty.call(values, f); });
    var coordsGiven = Object.prototype.hasOwnProperty.call(values, g.lat);
    if (touched && !coordsGiven) { values[g.lat] = ''; values[g.lng] = ''; }
  });

  Object.keys(values).forEach(function (h) {
    var c = headers.indexOf(h);
    if (c < 0) return;
    writeCell_(sh.getRange(rowIdx, c + 1), h, values[h]);
  });

  fillRowGeo_(tab, sh, headers, rowIdx);
  return readRowObject_(sh, headers, rowIdx, tz);
}

function writeCell_(range, header, v) {
  if (v === null || v === undefined) v = '';
  if (NUMBER_COLS.indexOf(header) >= 0) {
    range.setValue(v === '' ? '' : Number(v));
    return;
  }
  if (DATE_COLS.indexOf(header) >= 0 || TIME_COLS.indexOf(header) >= 0 || DATETIME_COLS.indexOf(header) >= 0) {
    range.setValue(String(v)); // ISO text such as 2030-03-07, 18:30 or 2030-03-07 18:30; Sheets parses it as a date/time
    return;
  }
  var s = String(v);
  // Text from the app is never run as a formula
  if (/^[=+@]/.test(s) || (/^-/.test(s) && !/^-?\d+(\.\d+)?$/.test(s))) s = "'" + s;
  // Keep things like confirmation numbers (00123) or "1/2" as text instead of letting Sheets turn them into numbers or dates.
  if (/^[\d\s.,:\/+-]+$/.test(s) && s.trim() !== '') {
    range.setNumberFormat('@');
  }
  range.setValue(s);
}

/** If a tool rewrote a tab without its ID column, adds it back at the end (headers is updated too). */
function ensureKeyCol_(sh, headers, key) {
  var col = headers.indexOf(key);
  if (col >= 0) return col;
  col = headers.length;
  sh.getRange(1, col + 1).setValue(key);
  headers.push(key);
  return col;
}

function headerRow_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
}

function findRow_(sh, keyCol, key) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var col = sh.getRange(2, keyCol + 1, last - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (String(col[i][0]).trim() === String(key).trim()) return i + 2;
  }
  return -1;
}

function readRowObject_(sh, headers, rowIdx, tz) {
  var vals = sh.getRange(rowIdx, 1, 1, headers.length).getValues()[0];
  var obj = { _row: rowIdx };
  headers.forEach(function (h, c) { if (h) obj[h] = toPlain_(vals[c], h, tz); });
  return obj;
}

function newId_(prefix) {
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

function moveIdea_(ideaId, reservation, editor) {
  var ss = SpreadsheetApp.getActive();
  var ideas = ss.getSheetByName('Ideas');
  var headers = headerRow_(ideas);
  var rowIdx = findRow_(ideas, headers.indexOf('ID'), ideaId);
  if (rowIdx < 0) throw new Error('Idea not found: ' + ideaId);
  var idea = readRowObject_(ideas, headers, rowIdx, ss.getSpreadsheetTimeZone());

  var source = String(idea['Source'] || '');
  var res = {
    'Type': idea['Type'] || 'Restaurant',
    'Name': idea['Name'],
    'City': idea['City'],
    'Address': idea['Address'],
    'Kid-friendly': idea['Kid-friendly'],
    'Link': /^https?:\/\//.test(source) ? source : '',
    'Status': 'Tentative',
    'Lat': idea['Lat'],
    'Lng': idea['Lng']
  };
  Object.keys(reservation).forEach(function (k) { res[k] = reservation[k]; });
  upsert_('Reservations', reservation['ID'] || null, res, editor);

  var note = idea['Notes'] ? idea['Notes'] + ' | ' : '';
  var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  upsert_('Ideas', ideaId, { 'Status': 'Confirmed', 'Notes': note + 'Moved to Reservations ' + stamp }, editor);
}

/** Appends a value to a column of the Lists tab (e.g. a new City), optionally with City Lat / City Lng. */
function addListValue_(column, value, extra) {
  var sh = SpreadsheetApp.getActive().getSheetByName(LISTS_TAB);
  var headers = headerRow_(sh);
  var c = headers.indexOf(column);
  if (c < 0) throw new Error('Unknown list column: ' + column);
  value = String(value || '').trim();
  if (!value) throw new Error('Empty value');
  var last = Math.max(sh.getLastRow(), 1);
  var col = sh.getRange(1, c + 1, last + 1, 1).getValues();
  for (var i = 1; i < col.length; i++) {
    if (String(col[i][0]).trim().toLowerCase() === value.toLowerCase()) return;
  }
  var target = col.length + 1;
  for (var j = 1; j < col.length; j++) {
    if (String(col[j][0]).trim() === '') { target = j + 1; break; }
  }
  sh.getRange(target, c + 1).setValue(value);
  if (column === 'City') {
    var lat = extra['City Lat'], lng = extra['City Lng'];
    if ((lat === undefined || lat === '') && typeof Maps !== 'undefined') {
      var g = geocode_(value + ', Japan');
      if (g) { lat = g.lat; lng = g.lng; }
    }
    var la = headers.indexOf('City Lat'), ln = headers.indexOf('City Lng');
    if (la >= 0 && lat !== undefined && lat !== '') sh.getRange(target, la + 1).setValue(Number(lat));
    if (ln >= 0 && lng !== undefined && lng !== '') sh.getRange(target, ln + 1).setValue(Number(lng));
  }
}

/* ------------------------------------------------------------------ */
/* Reading bookings with Claude, and keeping uploaded files            */
/* ------------------------------------------------------------------ */

// One flat row shape for every kind of booking; the app maps it onto the right tab.
// Structured outputs need every property listed in "required" and no extra properties.
var EXTRACT_FIELDS = {
  kind: { type: 'string', enum: ['stay', 'transport', 'reservation', 'note'], description: 'stay = hotel/ryokan/apartment; transport = flight, train, bus, ferry, car or transfer (one item per leg); reservation = restaurant, activity, tour, ticket, onsen; note = anything else worth keeping' },
  status: { type: 'string', enum: ['Confirmed', 'Tentative'], description: 'Confirmed if the document is a booking confirmation, Tentative for a quote, hold, wishlist or plan' },
  name: { type: 'string', description: 'Hotel, restaurant, activity or tour name. For transport: carrier and flight/train number, e.g. "JAL 6" or "Nozomi 21"' },
  date: { type: 'string', description: 'YYYY-MM-DD. Check-in date for a stay, departure date for transport, date of a reservation or note' },
  end_date: { type: 'string', description: 'YYYY-MM-DD check-out date for a stay; otherwise empty' },
  time: { type: 'string', description: 'HH:MM 24-hour Japan time: departure for transport, start time for a reservation; otherwise empty' },
  end_time: { type: 'string', description: 'HH:MM 24-hour Japan time of arrival for transport; otherwise empty' },
  city: { type: 'string', description: 'City in Japan where it happens (for a stay or reservation). Use a name from the known cities when it matches' },
  address: { type: 'string', description: 'Street address, if given' },
  from: { type: 'string', description: 'Transport only: departure city, station or airport' },
  to: { type: 'string', description: 'Transport only: arrival city, station or airport' },
  mode: { type: 'string', description: 'Transport only: Flight, Shinkansen, train, bus, ferry, car, taxi... Use a known mode when one matches' },
  reservation_type: { type: 'string', description: 'Reservation only: Restaurant, Activity, Tour... Use a known type when one matches' },
  seats: { type: 'string', description: 'Seat or car numbers, if given' },
  confirmation: { type: 'string', description: 'Confirmation, booking or reservation number' },
  party_size: { type: 'string', description: 'Number of people as digits, if stated; otherwise empty' },
  guests: { type: 'array', items: { type: 'string' }, description: 'Names of the travellers or guests exactly as written in the document' },
  cancellation_deadline: { type: 'string', description: 'YYYY-MM-DD HH:MM Japan time after which cancelling costs money, if stated' },
  link: { type: 'string', description: 'A booking or venue web address from the document, if any' },
  notes: { type: 'string', description: 'Short useful details that fit nowhere else: room type, meal plan, check-in time, baggage, payment due, the original time zone of converted times. Never card numbers or passport numbers' }
};
var EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    items: { type: 'array', items: { type: 'object', properties: EXTRACT_FIELDS, required: Object.keys(EXTRACT_FIELDS), additionalProperties: false } },
    warnings: { type: 'array', items: { type: 'string' }, description: 'Things the family should double-check, e.g. an unclear year or time zone' }
  },
  required: ['items', 'warnings'],
  additionalProperties: false
};

/** Reads pasted text and/or an uploaded file with Claude and returns rows for the app to review. */
function extract_(req, me) {
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) return { ok: false, error: 'ai_not_set' };
  var text = String(req.text || '').slice(0, TEXT_MAX_CHARS);
  var file = req.file && req.file.data ? { name: String(req.file.name || 'upload').slice(0, 120), mimeType: String(req.file.mimeType || ''), data: String(req.file.data) } : null;
  if (!text.trim() && !file) return { ok: false, error: 'nothing_to_read' };
  var bytes = null;
  if (file) {
    try { bytes = Utilities.base64Decode(file.data); } catch (err) { return { ok: false, error: 'bad_request' }; }
    if (bytes.length > UPLOAD_MAX_BYTES) return { ok: false, error: 'file_too_big' };
  }
  var readable = file && CLAUDE_FILE_TYPES.indexOf(file.mimeType) >= 0;
  if (file && !readable && !text.trim()) return { ok: false, error: 'file_type' };

  // A daily allowance per person keeps the API bill predictable
  var cache = CacheService.getScriptCache();
  var countKey = 'ai:' + me.email + ':' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  var used = Number(cache.get(countKey) || 0);
  if (used >= CLAUDE_DAILY_LIMIT) return { ok: false, error: 'ai_limit' };
  cache.put(countKey, String(used + 1), 86400);

  var res = callClaude_(key, text, readable ? file : null, req.hints || {});
  if (res.error) return { ok: false, error: res.error, message: res.message };
  return { ok: true, items: res.items, warnings: res.warnings };
}

function extractPrompt_(text, hasFile, hints) {
  var list = function (a) { return (Array.isArray(a) ? a : []).map(function (x) { return String(x).slice(0, 60); }).slice(0, 80).join(', '); };
  var lines = [
    'You read travel documents for a family trip to Japan and turn every booking or plan in them into rows for the family trip planner.',
    '',
    'Rules:',
    '- One item per booking. A flight or train journey with several legs is one transport item per leg. A return trip is two items.',
    '- Dates are YYYY-MM-DD. Times are HH:MM, 24-hour, in Japan time. If a time is printed in another time zone (e.g. a departure from abroad), convert it to Japan time and give the original in notes.',
    '- Leave a field as an empty string when the document does not say. Do not guess confirmation numbers, prices or names.',
    '- Never copy payment card numbers, passport numbers or passwords into any field.',
    '- If nothing in the input is a booking or a plan, return no items and say so in warnings.'
  ];
  if (hints.start && hints.end) lines.push('- The trip runs from ' + String(hints.start).slice(0, 10) + ' to ' + String(hints.end).slice(0, 10) + '. Dates written without a year are in that range; mention it in warnings if one is outside it.');
  if (list(hints.cities)) lines.push('- Known cities: ' + list(hints.cities) + '.');
  if (list(hints.modes)) lines.push('- Known transport modes: ' + list(hints.modes) + '.');
  if (list(hints.types)) lines.push('- Known reservation types: ' + list(hints.types) + '.');
  lines.push('');
  lines.push(hasFile ? 'The attached document is the booking.' + (text.trim() ? ' The person also pasted this text:' : '') : 'The person pasted this text:');
  if (text.trim()) lines.push('<pasted_text>\n' + text + '\n</pasted_text>');
  return lines.join('\n');
}

function callClaude_(key, text, file, hints) {
  var content = [];
  if (file) {
    content.push({ type: file.mimeType === 'application/pdf' ? 'document' : 'image', source: { type: 'base64', media_type: file.mimeType, data: file.data } });
  }
  content.push({ type: 'text', text: extractPrompt_(text, !!file, hints) });
  var body = {
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    // If the model declines a request, the API retries it on Anthropic's recommended fallback model
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: EXTRACT_SCHEMA } },
    messages: [{ role: 'user', content: content }]
  };
  var resp;
  try {
    resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
  } catch (err) {
    return { error: 'ai_unreachable' };
  }
  var code = resp.getResponseCode();
  var json = {};
  try { json = JSON.parse(resp.getContentText()); } catch (err) { /* handled below */ }
  if (code === 401 || code === 403) return { error: 'ai_key_bad' };
  if (code === 429 || code >= 500) return { error: 'ai_busy' };
  if (code !== 200) return { error: 'ai_failed', message: String((json.error && json.error.message) || ('HTTP ' + code)).slice(0, 300) };
  if (json.stop_reason === 'refusal') return { error: 'ai_refused' };
  if (json.stop_reason === 'max_tokens') return { error: 'ai_failed', message: 'The document is too long to read in one go. Try a shorter part of it.' };
  var texts = (json.content || []).filter(function (b) { return b.type === 'text'; });
  var parsed;
  try { parsed = JSON.parse(texts[texts.length - 1].text); } catch (err) { return { error: 'ai_failed', message: 'Unreadable answer.' }; }
  return { items: Array.isArray(parsed.items) ? parsed.items.slice(0, 50) : [], warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String).slice(0, 20) : [] };
}

/* ------------------------------------------------------------------ */
/* IDs and geocoding for rows typed directly into the Sheet            */
/* ------------------------------------------------------------------ */

/** Gives every row an ID and geocodes up to `limit` rows that lack coordinates. */
function fillMissing_(limit) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var ss = SpreadsheetApp.getActive();
    var budget = limit;
    Object.keys(TABS).forEach(function (tab) {
      var cfg = TABS[tab];
      var sh = ss.getSheetByName(tab);
      if (!sh || sh.getLastRow() < 2) return;
      var headers = headerRow_(sh);
      var n = sh.getLastRow() - 1;
      var data = sh.getRange(2, 1, n, headers.length).getValues();
      if (cfg.prefix) {
        var idc = headers.indexOf('ID');
        if (idc >= 0) {
          for (var i = 0; i < n; i++) {
            var blank = data[i].every(function (v) { return v === '' || v === null; });
            if (!blank && String(data[i][idc]).trim() === '') {
              sh.getRange(i + 2, idc + 1).setValue(newId_(cfg.prefix));
            }
          }
        }
      }
      if (GEO[tab]) {
        for (var r = 0; r < n && budget > 0; r++) {
          budget -= fillRowGeo_(tab, sh, headers, r + 2, data[r]);
        }
      }
    });
  } finally {
    lock.releaseLock();
  }
}

/** Geocodes the row's missing coordinates. Returns the number of geocoder calls made. */
function fillRowGeo_(tab, sh, headers, rowIdx, rowValues) {
  var targets = GEO[tab];
  if (!targets || typeof Maps === 'undefined') return 0;
  var vals = rowValues || sh.getRange(rowIdx, 1, 1, headers.length).getValues()[0];
  var get = function (h) { var c = headers.indexOf(h); return c < 0 ? '' : String(vals[c] === null ? '' : vals[c]).trim(); };
  var cities = null;
  var calls = 0;
  targets.forEach(function (g) {
    var la = headers.indexOf(g.lat), ln = headers.indexOf(g.lng);
    if (la < 0 || ln < 0) return;
    if (get(g.lat) !== '' && get(g.lng) !== '') return;
    if (g.needName && !get(g.needName) && !(g.address && get(g.address))) return;
    if (g.skipIfCity) {
      if (!cities) cities = readLists_(SpreadsheetApp.getActive()).cities.map(function (c) { return c.name.toLowerCase(); });
      if (cities.indexOf(get(g.skipIfCity).toLowerCase()) >= 0) return;
    }
    var q = (g.address && get(g.address)) || g.name.map(get).filter(String).join(', ');
    if (!q) return;
    var cache = CacheService.getScriptCache();
    var failKey = 'geofail:' + Utilities.base64EncodeWebSafe(q).slice(0, 200);
    if (cache.get(failKey)) return;
    calls++;
    var loc = geocode_(q + (/japan/i.test(q) ? '' : ', Japan'));
    if (!loc) { cache.put(failKey, '1', 21600); return; }
    sh.getRange(rowIdx, la + 1).setValue(loc.lat);
    sh.getRange(rowIdx, ln + 1).setValue(loc.lng);
  });
  return calls;
}

function geocode_(q) {
  try {
    var res = Maps.newGeocoder().setRegion('jp').setLanguage('en').geocode(q);
    if (res && res.status === 'OK' && res.results && res.results.length) {
      var l = res.results[0].geometry.location;
      return { lat: round6_(l.lat), lng: round6_(l.lng) };
    }
  } catch (err) { /* quota or network: try again later */ }
  return null;
}

function round6_(x) { return Math.round(x * 1e6) / 1e6; }

/**
 * Turns pasted text into coordinates: "35.68, 139.76", a full Google Maps
 * link, or a short maps.app.goo.gl / goo.gl link (followed server-side).
 */
function resolveLocation_(text) {
  text = text.trim();
  var direct = parseCoords_(text);
  if (direct) return direct;
  var m = text.match(/https?:\/\/[^\s]+/);
  if (!m) return geocode_(text);
  var url = m[0];
  for (var i = 0; i < 5; i++) {
    var c = parseCoords_(url);
    if (c) return c;
    if (!/^https:\/\/(maps\.app\.goo\.gl|goo\.gl|(www\.|maps\.)?google\.[a-z.]+)\//.test(url)) return null;
    var resp = UrlFetchApp.fetch(url, { followRedirects: false, muteHttpExceptions: true });
    var headers = resp.getHeaders();
    var next = headers['Location'] || headers['location'];
    if (!next) {
      var body = resp.getContentText().slice(0, 200000);
      return parseCoords_(body);
    }
    url = next;
  }
  return null;
}

function parseCoords_(s) {
  s = decodeURIComponent(String(s));
  var pats = [
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /[?&](?:q|query|ll|center|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
    /^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/
  ];
  for (var i = 0; i < pats.length; i++) {
    var m = s.match(pats[i]);
    if (m) {
      var lat = Number(m[1]), lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat: round6_(lat), lng: round6_(lng) };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Sheet menu and triggers                                             */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Trip app')
    .addItem('Set up the administrator (you)…', 'menuSetupAdmin')
    .addItem('Who has access', 'menuListAccess')
    .addItem('Remove a person’s access…', 'menuRemoveAccess')
    .addSeparator()
    .addItem('Fill IDs and map locations now', 'menuFillMissing')
    .addItem('Turn on automatic location filling', 'installTriggers')
    .addSeparator()
    .addItem('Set the Claude API key (reading bookings)…', 'menuSetClaudeKey')
    .addItem('Turn off reading bookings with Claude', 'menuClearClaudeKey')
    .addToUi();
}

/** Simple trigger: stamp "Last edited by" and an ID on rows edited by hand in the Sheet. */
function onEdit(e) {
  try {
    var sh = e.range.getSheet();
    var tab = sh.getName();
    var cfg = TABS[tab];
    if (!cfg || e.range.getRow() < 2) return;
    var headers = headerRow_(sh);
    var editedCol = headers.indexOf('Last edited by');
    var idCol = headers.indexOf('ID');
    var who = '';
    try { who = Session.getActiveUser().getEmail(); } catch (err) { /* not available for other accounts */ }
    for (var r = e.range.getRow(); r <= e.range.getLastRow(); r++) {
      if (editedCol >= 0 && !(e.range.getNumColumns() === 1 && e.range.getColumn() === editedCol + 1)) {
        sh.getRange(r, editedCol + 1).setValue(who ? 'Sheet (' + who + ')' : 'Sheet');
      }
      if (cfg.prefix && idCol >= 0 && String(sh.getRange(r, idCol + 1).getValue()).trim() === '') {
        sh.getRange(r, idCol + 1).setValue(newId_(cfg.prefix));
      }
    }
  } catch (err) { /* never block a person's edit */ }
}

function menuSetupAdmin() {
  var ui = SpreadsheetApp.getUi();
  var ask = function (title, text) {
    var r = ui.prompt(title, text, ui.ButtonSet.OK_CANCEL);
    return r.getSelectedButton() === ui.Button.OK ? r.getResponseText().trim() : null;
  };
  var existing = loadUsers_().filter(function (x) { return x.role === 'admin'; })[0];
  if (existing && ui.alert('Replace the administrator?', 'The administrator is currently ' + existing.name + ' (' + existing.email + '). Replace it? That account is signed out everywhere.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var email = ask('Administrator: email', 'Your email address. You sign in to the app with it.');
  if (!email) return;
  var name = ask('Administrator: name', 'Your name as it appears in the People tab.');
  if (!name) return;
  var pin = ask('Administrator: PIN', 'Choose a PIN of ' + ADMIN_PIN_MIN + '–' + PIN_MAX + ' digits. Nobody else should know it. (It is shown here as you type; close the dialog afterwards.)');
  if (!pin) return;
  var problem = setupAdmin_(email, name, pin);
  ui.alert(problem ? 'Not saved' : 'Administrator set up', problem || 'Sign in to the app with ' + normEmail_(email) + ' and your PIN. In the app, Settings → People with access lets you add family members.', ui.ButtonSet.OK);
}

function menuRemoveAccess() {
  var ui = SpreadsheetApp.getUi();
  var users = loadUsers_().filter(function (x) { return x.role !== 'admin'; });
  if (!users.length) { ui.alert('Nobody besides the administrator has access.'); return; }
  var res = ui.prompt('Remove access', 'Email of the person to remove:\n' + users.map(function (u) { return u.name + ' – ' + u.email; }).join('\n'), ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var r = adminRemoveUser_(res.getResponseText());
  ui.alert(r.ok ? 'Access removed. Their app erases its copy of the trip the next time it goes online.' : 'No one with that email has access.');
}

function menuListAccess() {
  var users = loadUsers_();
  SpreadsheetApp.getUi().alert('Who has access', users.length
    ? users.map(function (u) {
      return u.name + ' – ' + u.email + (u.role === 'admin' ? ' (administrator)' : '') + (u.disabled ? ' – blocked' : '') + ' – signed in on ' + (u.sessions || []).length + ' device(s)';
    }).join('\n')
    : 'Nobody yet. Use Trip app → Set up the administrator (you)…', SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuSetClaudeKey() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Claude API key', 'Paste the API key from console.anthropic.com (it starts with sk-ant-). It is kept in this script’s settings and never sent to the app. Set a monthly spend limit in the Anthropic console.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var key = r.getResponseText().trim();
  if (!/^sk-ant-[\w-]{20,}$/.test(key)) { ui.alert('That does not look like an Anthropic API key. Nothing was saved.'); return; }
  PropertiesService.getScriptProperties().setProperty('ANTHROPIC_API_KEY', key);
  ui.alert('Saved. Family members can now use “Import from a file or text” in the app (after you deploy a new version, if you have not yet).');
}

function menuClearClaudeKey() {
  PropertiesService.getScriptProperties().deleteProperty('ANTHROPIC_API_KEY');
  SpreadsheetApp.getUi().alert('Reading bookings with Claude is off. The key was removed from this script.');
}

function menuFillMissing() {
  fillMissing_(100);
  SpreadsheetApp.getActive().toast('IDs and map locations filled in.');
}

/** Fills IDs and coordinates every 15 minutes for rows typed into the Sheet. */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'timedFill') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('timedFill').timeBased().everyMinutes(15).create();
  try { SpreadsheetApp.getActive().toast('Automatic location filling is on.'); } catch (err) { /* run from editor */ }
}

function timedFill() {
  fillMissing_(50);
}
