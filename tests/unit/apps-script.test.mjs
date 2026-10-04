import { describe, it, expect } from 'vitest';
import { createGas, TEST_USERS } from '../../dev/gas-fake.mjs';

const { admin, casey, blake } = TEST_USERS;
const login = (g, u, pin = u.pin) => g.post({ action: 'login', email: u.email, pin });
/** Reads or changes one stored account, as the script keeps it in Script Properties. */
function editUser(g, email, fn) {
  const u = JSON.parse(g.props.get(`USER:${email}`));
  fn(u);
  g.props.set(`USER:${email}`, JSON.stringify(u));
}
/** Pretends the 15-minute lock on an account has run out. */
const expireLock = (g, email) => editUser(g, email, (u) => { u.lockedUntil = Date.now() - 1; });

describe('Apps Script API: accounts', () => {
  it('refuses everything until the administrator is set up', () => {
    const g = createGas({ users: {} });
    expect(login(g, admin).error).toBe('access_not_set');
    expect(g.post({ action: 'read', token: 'x' }).error).toBe('access_not_set');
  });

  it('signs in with email (any case) and PIN, and identifies the person', () => {
    const g = createGas();
    const r = login(g, { ...casey, email: ' CASEY@Example.com ' });
    expect(r.ok).toBe(true);
    expect(r.token).toMatch(/^[0-9a-f]{96}$/);
    expect(r.me).toMatchObject({ name: 'Casey', email: 'casey@example.com', role: 'member', mustChangePin: false });
    expect(g.post({ action: 'read', token: r.token }).me.name).toBe('Casey');
  });

  it('gives the same answer for an unknown email and a wrong PIN', () => {
    const g = createGas();
    expect(login(g, { email: 'nobody@example.com', pin: '111222' }).error).toBe('bad_login');
    expect(login(g, casey, '999000').error).toBe('bad_login');
  });

  it('locks an account for 15 minutes after 5 wrong PINs, and blocks it after 10', () => {
    const g = createGas();
    for (let i = 0; i < 4; i++) expect(login(g, casey, '000111').error).toBe('bad_login');
    expect(login(g, casey, '000111').error).toBe('account_locked');
    expect(login(g, casey).error).toBe('account_locked'); // even the right PIN, while locked
    expireLock(g, casey.email); // 15 minutes later
    for (let i = 0; i < 4; i++) login(g, casey, '000111');
    expect(login(g, casey, '000111').error).toBe('account_disabled');
    expect(login(g, casey).error).toBe('account_disabled');
    // Other people are not affected
    expect(login(g, admin).ok).toBe(true);
  });

  it('a correct PIN resets the wrong-PIN count', () => {
    const g = createGas();
    for (let i = 0; i < 4; i++) login(g, casey, '000111');
    expect(login(g, casey).ok).toBe(true);
    for (let i = 0; i < 4; i++) expect(login(g, casey, '000111').error).toBe('bad_login');
  });

  it('first sign-in: told to choose a PIN; changing it keeps this phone signed in and signs out the others', () => {
    const g = createGas();
    const first = login(g, blake);
    const other = login(g, blake).token;
    expect(first.me.mustChangePin).toBe(true);
    expect(g.post({ action: 'changePin', token: first.token, currentPin: '000000', newPin: '582047' }).error).toBe('bad_current_pin');
    expect(g.post({ action: 'changePin', token: first.token, currentPin: blake.pin, newPin: '123456' }).error).toBe('pin_too_simple');
    expect(g.post({ action: 'changePin', token: first.token, currentPin: blake.pin, newPin: '777777' }).error).toBe('pin_too_simple');
    expect(g.post({ action: 'changePin', token: first.token, currentPin: blake.pin, newPin: '12ab56' }).error).toBe('pin_format');
    const ok = g.post({ action: 'changePin', token: first.token, currentPin: blake.pin, newPin: '582047' });
    expect(ok.me.mustChangePin).toBe(false);
    expect(g.post({ action: 'read', token: first.token }).ok).toBe(true);
    expect(g.post({ action: 'read', token: other }).error).toBe('bad_session');
    expect(login(g, blake).error).toBe('bad_login');
    expect(login(g, blake, '582047').ok).toBe(true);
  });

  it('only the administrator can manage access, and nobody can create another administrator from the app', () => {
    const g = createGas();
    const kt = login(g, casey).token;
    for (const action of ['adminListUsers', 'adminAddUser', 'adminResetPin', 'adminUnlock', 'adminRemoveUser']) {
      expect(g.post({ action, token: kt, email: 'x@example.com', name: 'X', pin: '583920', role: 'admin' }).error).toBe('not_admin');
    }
    const at = login(g, admin).token;
    const added = g.post({ action: 'adminAddUser', token: at, email: 'Emery@Example.com', name: 'Emery', pin: '502817', role: 'admin' });
    expect(added.ok).toBe(true);
    expect(added.users.find((u) => u.email === 'emery@example.com')).toMatchObject({ name: 'Emery', role: 'member', mustChangePin: true });
    expect(added.users.filter((u) => u.role === 'admin')).toHaveLength(1);
    expect(g.post({ action: 'adminAddUser', token: at, email: 'emery@example.com', name: 'E2', pin: '502817' }).error).toBe('email_exists');
    // Children (People tab: "Child") never get accounts; their parents act for them
    expect(g.post({ action: 'adminAddUser', token: at, email: 'kit@example.com', name: 'kit', pin: '502817' }).error).toBe('child_no_account');
    expect(g.post({ action: 'adminAddUser', token: at, email: 'not-an-email', name: 'D', pin: '502817' }).error).toBe('bad_email');
    expect(g.post({ action: 'adminAddUser', token: at, email: 'd@example.com', name: 'D', pin: '1234' }).error).toBe('pin_format');
    expect(g.post({ action: 'adminRemoveUser', token: at, email: admin.email }).error).toBe('admin_from_sheet');
    expect(g.post({ action: 'adminResetPin', token: at, email: admin.email, pin: '502817' }).error).toBe('admin_from_sheet');
  });

  it('the administrator can reset a PIN (signing that person out), unlock, and remove access', () => {
    const g = createGas();
    const at = login(g, admin).token;
    const kt = login(g, casey).token;
    expect(g.post({ action: 'adminResetPin', token: at, email: casey.email, pin: '640213' }).ok).toBe(true);
    expect(g.post({ action: 'read', token: kt }).error).toBe('bad_session');
    expect(login(g, casey, '640213').me.mustChangePin).toBe(true);
    for (let i = 0; i < 5; i++) login(g, casey, '000111');
    expireLock(g, casey.email);
    for (let i = 0; i < 5; i++) login(g, casey, '000111');
    expect(g.post({ action: 'adminListUsers', token: at }).users.find((u) => u.email === casey.email).disabled).toBe(true);
    g.post({ action: 'adminUnlock', token: at, email: casey.email });
    const kt2 = login(g, casey, '640213').token;
    expect(kt2).toBeTruthy();
    expect(g.post({ action: 'adminRemoveUser', token: at, email: casey.email }).ok).toBe(true);
    expect(g.post({ action: 'read', token: kt2 }).error).toBe('bad_session');
    expect(login(g, casey, '640213').error).toBe('bad_login');
  });

  it('the administrator PIN is set only from the Sheet menu, with at least 8 digits', () => {
    const g = createGas();
    expect(g.ctx.setupAdmin_('new@example.com', 'New', '1357')).toMatch(/8–12 digits/);
    expect(g.ctx.setupAdmin_('new@example.com', 'New', '86420135')).toBe(null);
    const admins = [...g.props.values()].map((v) => JSON.parse(v)).filter((u) => u.role === 'admin');
    expect(admins.map((u) => u.email)).toEqual(['new@example.com']); // the old administrator is gone
    expect(login(g, admin).error).toBe('bad_login');
  });

  it('signing out ends that session only; idle sessions expire after 30 days', () => {
    const g = createGas();
    const a = login(g, casey).token;
    const b = login(g, casey).token;
    g.post({ action: 'logout', token: a });
    expect(g.post({ action: 'read', token: a }).error).toBe('bad_session');
    expect(g.post({ action: 'read', token: b }).ok).toBe(true);
    editUser(g, casey.email, (u) => u.sessions.forEach((x) => { x.lastUsed = new Date(Date.now() - 31 * 86400000).toISOString(); }));
    expect(g.post({ action: 'read', token: b }).error).toBe('bad_session');
  });

  it('fits a large family within the 9 KB-per-property limit', () => {
    const g = createGas();
    const at = login(g, admin).token;
    for (let i = 0; i < 25; i++) expect(g.post({ action: 'adminAddUser', token: at, email: `p${i}@example.com`, name: `Person ${i}`, pin: '502817' }).ok).toBe(true);
    for (let i = 0; i < 6; i++) expect(login(g, { email: 'p0@example.com', pin: '502817' }).ok).toBe(true);
    expect(g.post({ action: 'adminListUsers', token: at }).users).toHaveLength(28);
  });

  it('keeps at most 5 signed-in devices per person', () => {
    const g = createGas();
    const tokens = Array.from({ length: 6 }, () => login(g, casey).token);
    expect(g.post({ action: 'read', token: tokens[0] }).error).toBe('bad_session');
    expect(g.post({ action: 'read', token: tokens[5] }).ok).toBe(true);
  });

  it('stores only hashes of PINs and session tokens', () => {
    const g = createGas();
    const token = login(g, casey).token;
    const stored = JSON.stringify(Object.fromEntries(g.props));
    expect(stored).not.toContain(casey.pin);
    expect(stored).not.toContain(token);
    expect(stored).not.toContain(admin.pin);
  });
});

describe('Apps Script API: data', () => {
  let C;
  const createGasAs = (opts) => { const g = createGas(opts); C = g.login(admin); return g; };
  it('reads dates as typed, regardless of the Sheet time zone, and assigns IDs', () => {
    const g = createGasAs();
    const res = g.post({ action: 'read', token: C });
    expect(res.ok).toBe(true);
    const stays = res.data.tabs.Stays.rows;
    expect(stays).toHaveLength(8);
    expect(stays[0]['Check-in']).toBe('2030-03-04');
    expect(stays[0]['Check-out']).toBe('2030-03-05');
    expect(stays.every((s) => /^S-[0-9a-f]{8}$/.test(s.ID))).toBe(true);
    expect(res.data.lists.cities.find((c) => c.name === 'Okinawa')).toEqual({ name: 'Okinawa', lat: 26.2125, lng: 127.6792 });
    expect(res.data.lists.columns.Mode).toContain('Shinkansen');
  });

  it('appends, then updates only the fields sent; "Last edited by" is the signed-in person', () => {
    const g = createGasAs();
    const add = g.post({
      action: 'upsert', token: C, tab: 'Reservations', editor: 'Someone else',
      values: { ID: 'R-test0001', Date: '2030-03-06', Time: '18:30', Type: 'Restaurant', Name: 'Soup curry place', City: 'Otaru', Who: 'Everyone', 'Cancellation deadline': '2030-03-04 18:30', 'Confirmation #': '00123', Status: 'Confirmed' },
    });
    expect(add.ok).toBe(true);
    expect(add.row).toMatchObject({ ID: 'R-test0001', Date: '2030-03-06', Time: '18:30', 'Cancellation deadline': '2030-03-04 18:30', 'Confirmation #': '00123', 'Last edited by': 'Avery' });
    expect(typeof add.row.Lat).toBe('number'); // geocoded from Name + City

    const upd = g.post({ action: 'upsert', token: g.login(casey), tab: 'Reservations', key: 'R-test0001', values: { Time: '19:00' } });
    expect(upd.row.Time).toBe('19:00');
    expect(upd.row.Name).toBe('Soup curry place');
    expect(upd.row['Last edited by']).toBe('Casey');
    expect(upd.data.tabs.Reservations.rows).toHaveLength(1);
  });

  it('is idempotent when the same new row is sent twice (offline retry)', () => {
    const g = createGasAs();
    const body = { action: 'upsert', token: C, tab: 'Notes', values: { ID: 'N-abc', Date: '2030-03-07', City: 'Otaru', Who: 'Kit', Note: 'Bring rain jacket' } };
    g.post(body);
    const again = g.post(body);
    expect(again.data.tabs.Notes.rows).toHaveLength(1);
  });

  it('keeps explicit coordinates and re-geocodes when the address changes', () => {
    const g = createGasAs();
    const id = g.post({ action: 'read', token: C }).data.tabs.Stays.rows[1].ID;
    g.post({ action: 'upsert', token: C, tab: 'Stays', key: id, values: { Hotel: 'Hotel A', Lat: 43.19, Lng: 141.0 } });
    let s = g.post({ action: 'read', token: C }).data.tabs.Stays.rows[1];
    expect([s.Lat, s.Lng]).toEqual([43.19, 141.0]);
    g.post({ action: 'upsert', token: C, tab: 'Stays', key: s.ID, values: { Address: '1-1 Inaho, Otaru' } });
    s = g.post({ action: 'read', token: C }).data.tabs.Stays.rows[1];
    expect(s.Lat).not.toBe(43.19);
    expect(typeof s.Lat).toBe('number');
  });

  it('does not geocode transport endpoints that are Lists cities', () => {
    const g = createGasAs();
    const r = g.post({ action: 'upsert', token: C, tab: 'Transport', values: { ID: 'T-1', Date: '2030-03-08', Depart: '09:30', Arrive: '12:00', From: 'Otaru', To: 'Hakodate Station', Who: 'Everyone' } });
    expect(r.row['From Lat']).toBe('');
    expect(typeof r.row['To Lat']).toBe('number');
  });

  it('moves a restaurant idea to Reservations', () => {
    const g = createGasAs();
    g.post({ action: 'upsert', token: C, tab: 'Restaurant ideas', values: { ID: 'I-1', Name: 'Ramen alley', City: 'Sapporo', 'Kid-friendly': 'Yes', Status: 'Idea' } });
    const r = g.post({ action: 'moveIdea', token: C, ideaId: 'I-1', reservation: { ID: 'R-9', Date: '2030-03-04', Time: '12:00', Who: 'Everyone' } });
    expect(r.ok).toBe(true);
    const res = r.data.tabs.Reservations.rows[0];
    expect(res).toMatchObject({ ID: 'R-9', Name: 'Ramen alley', City: 'Sapporo', 'Kid-friendly': 'Yes', Type: 'Restaurant', Status: 'Tentative', 'Last edited by': 'Avery' });
    const idea = r.data.tabs['Restaurant ideas'].rows[0];
    expect(idea.Status).toBe('Confirmed');
    expect(idea.Notes).toMatch(/^Moved to Reservations \d{4}-\d{2}-\d{2}$/);
  });

  it('adds a city to Lists with coordinates, without duplicates', () => {
    const g = createGasAs();
    g.post({ action: 'addListValue', token: C, column: 'City', value: 'Naha' });
    const r = g.post({ action: 'addListValue', token: C, column: 'City', value: 'naha' });
    const cities = r.data.lists.cities.filter((c) => c.name.toLowerCase() === 'naha');
    expect(cities).toHaveLength(1);
    expect(typeof cities[0].lat).toBe('number');
  });

  it('resolves pasted coordinates and Google Maps links', () => {
    const g = createGasAs();
    const loc = (text) => g.post({ action: 'resolveLocation', token: C, text }).location;
    expect(loc('35.0116, 135.7681')).toEqual({ lat: 35.0116, lng: 135.7681 });
    expect(loc('https://www.google.com/maps/place/X/@34.9671,135.7727,17z/data=!3m1!4b1!4m6!3m5!3d34.9671!4d135.7727')).toEqual({ lat: 34.9671, lng: 135.7727 });
    expect(loc('https://maps.app.goo.gl/abc123')).toEqual({ lat: 35.0394, lng: 135.7292 });
    expect(loc('https://evil.example.com/x')).toBe(null);
  });

  it('never writes text from the app as a formula', () => {
    const g = createGasAs();
    const r = g.post({ action: 'upsert', token: C, tab: 'Notes', values: { ID: 'N-f', Note: '=IMPORTXML("http://x","//a")', City: '+81 3', Who: '-Kit' } });
    expect(r.row.Note).toBe('=IMPORTXML("http://x","//a")');
    expect(r.row.City).toBe('+81 3');
    expect(r.row.Who).toBe('-Kit');
    const cells = g.ss.getSheetByName('Notes').cells[1];
    expect(cells.some((c) => c && typeof c === 'object' && c.formula)).toBe(false);
  });

  it('updates a person by name', () => {
    const g = createGasAs();
    const r = g.post({ action: 'upsert', token: C, tab: 'People', key: 'Robin', values: { Name: 'Robin', Notes: 'Age 3, naps 13:00' } });
    expect(r.row.Notes).toBe('Age 3, naps 13:00');
    expect(r.data.tabs.People.rows).toHaveLength(9);
  });
});

describe('Apps Script API: reading bookings with Claude', () => {
  const KEY = 'sk-ant-test-key-0123456789abcdefghij';
  const setup = () => { const g = createGas(); g.props.set('ANTHROPIC_API_KEY', KEY); return g; };
  const pdf = { name: 'hotel.pdf', mimeType: 'application/pdf', data: Buffer.from('%PDF-1.4 fake').toString('base64') };

  it('is off until the API key is set in the Sheet menu', () => {
    const g = createGas();
    const r = g.post({ action: 'extract', token: g.login(casey), text: 'Hotel booking' });
    expect(r.error).toBe('ai_not_set');
    expect(g.calls.claude).toHaveLength(0);
  });

  it('needs a signed-in person', () => {
    const g = setup();
    expect(g.post({ action: 'extract', token: 'nope', text: 'Hotel' }).error).toBe('bad_session');
    expect(g.calls.claude).toHaveLength(0);
  });

  it('sends pasted text with trip hints and returns rows; the key never reaches the app', () => {
    const g = setup();
    const r = g.post({ action: 'extract', token: g.login(casey), text: 'Your stay at Harbor View', hints: { start: '2030-03-04', end: '2030-03-27', cities: ['Otaru', 'Sapporo'], modes: ['Flight'], types: ['Restaurant'] } });
    expect(r.ok).toBe(true);
    expect(r.items.map((i) => i.kind)).toEqual(['stay', 'transport']);
    expect(r.warnings).toContain('Check the flight time zone.');
    expect(JSON.stringify(r)).not.toContain(KEY);
    const call = g.calls.claude[0];
    expect(call.headers).toMatchObject({ 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01' });
    expect(call.body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', output_config: { effort: 'low', format: { type: 'json_schema' } } });
    expect(call.body.tool_choice).toBeUndefined();
    expect(call.body.thinking).toBeUndefined();
    const prompt = call.body.messages[0].content.at(-1).text;
    expect(prompt).toContain('Your stay at Harbor View');
    expect(prompt).toContain('2030-03-04 to 2030-03-27');
    expect(prompt).toContain('Known cities: Otaru, Sapporo');
    // The family's names from the People tab are not sent
    expect(prompt).not.toMatch(/Avery|Blake|Robin/);
  });

  it('every object in the output schema lists all its properties as required, with no extras', () => {
    const g = setup();
    g.post({ action: 'extract', token: g.login(casey), text: 'x' });
    const walk = (s) => {
      if (s.type === 'object') {
        expect(s.additionalProperties).toBe(false);
        expect([...s.required].sort()).toEqual(Object.keys(s.properties).sort());
        Object.values(s.properties).forEach(walk);
      }
      if (s.type === 'array') walk(s.items);
    };
    walk(g.calls.claude[0].body.output_config.format.schema);
  });

  it('sends a PDF as a document block and an image as an image block', () => {
    const g = setup();
    const token = g.login(casey);
    g.post({ action: 'extract', token, file: pdf });
    expect(g.calls.claude[0].body.messages[0].content[0]).toEqual({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.data } });
    g.post({ action: 'extract', token, file: { ...pdf, name: 'a.png', mimeType: 'image/png' } });
    expect(g.calls.claude[1].body.messages[0].content[0].type).toBe('image');
  });

  it('refuses unreadable file types without text, and files over the size limit', () => {
    const g = setup();
    const token = g.login(casey);
    expect(g.post({ action: 'extract', token, file: { ...pdf, mimeType: 'application/zip' } }).error).toBe('file_type');
    const big = Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64');
    expect(g.post({ action: 'extract', token, file: { ...pdf, data: big } }).error).toBe('file_too_big');
    expect(g.post({ action: 'extract', token }).error).toBe('nothing_to_read');
    expect(g.calls.claude).toHaveLength(0);
  });

  it('reports refusals, bad keys and the daily limit', () => {
    const g = setup();
    const token = g.login(casey);
    expect(g.post({ action: 'extract', token, text: 'REFUSE' }).error).toBe('ai_refused');
    expect(g.post({ action: 'extract', token, text: 'BADKEY' }).error).toBe('ai_key_bad');
    for (let i = 2; i < 40; i++) g.post({ action: 'extract', token, text: 'NOTHING' });
    expect(g.post({ action: 'extract', token, text: 'x' }).error).toBe('ai_limit');
    // The limit is per person
    expect(g.post({ action: 'extract', token: g.login(admin), text: 'x' }).ok).toBe(true);
  });

  it('keeps the file in a private uploads folder only when asked, and serves it back', () => {
    const g = setup();
    const token = g.login(casey);
    expect(g.post({ action: 'extract', token, file: pdf }).attachment).toBeUndefined();
    expect(g.drive.size).toBe(0);
    const r = g.post({ action: 'extract', token, file: pdf, keep: true });
    expect(r.attachment).toMatch(/^https:\/\/drive\.google\.com\/file\/d\/[\w-]+\/view$/);
    const folderId = g.props.get('UPLOAD_FOLDER_ID');
    const folder = g.drive.get(folderId);
    expect(folder).toMatchObject({ name: 'Trip app uploads', mimeType: 'application/vnd.google-apps.folder' });
    const file = [...g.drive.values()].find((f) => f.parents?.includes(folderId));
    expect(file).toMatchObject({ mimeType: 'application/pdf', appProperties: { uploadedBy: 'casey@example.com' } });
    expect(file.name).toMatch(/hotel\.pdf$/);
    // Anyone signed in can open it through the app
    const a = g.post({ action: 'attachment', token: g.login(blake), id: r.attachment });
    expect(a).toMatchObject({ ok: true, mimeType: 'application/pdf' });
    expect(Buffer.from(a.data, 'base64').toString()).toBe('%PDF-1.4 fake');
    // A second upload reuses the folder
    g.post({ action: 'extract', token, file: pdf, keep: true });
    expect([...g.drive.values()].filter((f) => f.mimeType === 'application/vnd.google-apps.folder')).toHaveLength(1);
  });

  it('serves only files inside the uploads folder', () => {
    const g = setup();
    const token = g.login(casey);
    g.post({ action: 'extract', token, file: pdf, keep: true });
    g.drive.set('otherfile12345', { id: 'otherfile12345', name: 'private.pdf', parents: ['root'], trashed: false, bytes: [1] });
    expect(g.post({ action: 'attachment', token, id: 'https://drive.google.com/file/d/otherfile12345/view' }).error).toBe('no_attachment');
    expect(g.post({ action: 'attachment', token, id: '../etc' }).error).toBe('no_attachment');
    // The folder itself is not a file to serve
    expect(g.post({ action: 'attachment', token, id: g.props.get('UPLOAD_FOLDER_ID') }).error).toBe('no_attachment');
  });

  it('lets only the uploader or the administrator discard an upload', () => {
    const g = setup();
    const r = g.post({ action: 'extract', token: g.login(casey), file: pdf, keep: true });
    expect(g.post({ action: 'discardUpload', token: g.login(blake), id: r.attachment }).error).toBe('not_yours');
    expect(g.post({ action: 'discardUpload', token: g.login(casey), id: r.attachment }).ok).toBe(true);
    expect(g.post({ action: 'attachment', token: g.login(casey), id: r.attachment }).error).toBe('no_attachment');
  });

  it('stores the Attachment link on a row like any other field', () => {
    const g = setup();
    const token = g.login(casey);
    const r = g.post({ action: 'extract', token, file: pdf, keep: true });
    const up = g.post({ action: 'upsert', token, tab: 'Stays', values: { 'Check-in': '2030-03-05', 'Check-out': '2030-03-08', City: 'Otaru', Who: 'Casey', Attachment: r.attachment } });
    expect(up.row.Attachment).toBe(r.attachment);
  });
});
