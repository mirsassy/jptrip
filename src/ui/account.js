// Sign-in, PIN changes, and the administrator's "People with access" panel.
import { h, icon, clear, sheet, toast } from './dom.js';
import { state, signIn, signOut, changePin, admin, sync } from '../lib/store.js';
import { ERROR_TEXT, scriptUrlFrom, pinProblem, randomPin } from '../lib/api.js';
import { ago, fmtJstStamp } from '../lib/dates.js';
import { safeUrl, personChip } from './common.js';
import { openEditor } from './forms.js';

const errText = (e) => (e.code === 'account_locked' && e.minutes ? `Too many wrong PINs. Try again in ${e.minutes} min, or ask the trip organizer.` : ERROR_TEXT[e.code] || e.message || 'Something went wrong.');
const pinInput = (attrs = {}) => h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', maxlength: 12, ...attrs });

/* ---------------- Welcome / sign in ---------------- */
export function renderSignIn(root) {
  clear(root);
  const c = state.config;
  const url = h('input', { type: 'url', value: c.url || '', placeholder: 'Paste the invite link', autocomplete: 'off', inputmode: 'url' });
  const email = h('input', { type: 'email', autocomplete: 'username', inputmode: 'email', autocapitalize: 'none', spellcheck: 'false' });
  const pin = pinInput({ autocomplete: 'current-password' });
  const status = h('div', { class: 'small', 'aria-live': 'polite' });
  const go = h('button', { class: 'btn primary', type: 'submit' }, 'Sign in');
  const form = h('form', null,
    h('label', { class: 'field' }, h('span', null, 'Invite link ', h('span', { class: 'hint' }, '(from the trip organizer)')), url),
    h('label', { class: 'field' }, h('span', null, 'Email'), email),
    h('label', { class: 'field' }, h('span', null, 'PIN'), pin),
    h('div', { class: 'row' }, go), status);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = scriptUrlFrom(url.value);
    url.value = u;
    if (!/^https:\/\//.test(u) && !/^http:\/\/localhost/.test(u)) { status.textContent = 'Paste the invite link from the trip organizer.'; return; }
    if (!email.value.trim() || !pin.value) { status.textContent = 'Enter your email and PIN.'; return; }
    go.disabled = true;
    status.textContent = 'Signing in…';
    try {
      const me = await signIn(u, email.value.trim(), pin.value);
      const firstPin = pin.value;
      pin.value = '';
      location.hash = '#day';
      toast(`Signed in as ${me.name}.`);
      if (me.mustChangePin) openChangePin({ firstTime: true, currentPin: firstPin });
    } catch (err) {
      status.textContent = errText(err);
      pin.value = '';
    } finally {
      go.disabled = false;
    }
  });
  root.append(h('div', { class: 'card', style: { maxWidth: '560px', margin: '16px auto' } },
    h('h2', { style: { marginTop: 0 } }, 'Welcome'),
    h('p', null, 'Sign in with the email and PIN the trip organizer gave you. You only do this once on each device.'),
    form));
}

/* ---------------- Change PIN ---------------- */
export function openChangePin({ firstTime = false, currentPin = '' } = {}) {
  const me = state.config.me || {};
  const min = me.role === 'admin' ? 8 : 6;
  const cur = pinInput({ autocomplete: 'current-password', value: currentPin });
  const next = pinInput({ autocomplete: 'new-password' });
  const again = pinInput({ autocomplete: 'new-password' });
  const status = h('div', { class: 'small err', 'aria-live': 'polite' });
  const save = h('button', { type: 'submit', class: 'btn primary' }, 'Save new PIN');
  const form = h('form', null,
    firstTime ? h('p', null, 'The trip organizer chose your current PIN. For your own privacy, pick a new one that only you know.') : null,
    h('label', { class: 'field', hidden: firstTime && currentPin ? true : null }, h('span', null, 'Current PIN'), cur),
    h('label', { class: 'field' }, h('span', null, 'New PIN ', h('span', { class: 'hint' }, `(${min}–12 digits)`)), next),
    h('label', { class: 'field' }, h('span', null, 'New PIN again'), again),
    h('p', { class: 'small muted' }, 'Avoid birthdays and patterns like 123456 or 111111. Changing your PIN signs you out on your other devices.'),
    status,
    h('div', { class: 'form-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => s.close() }, firstTime ? 'Not now' : 'Close'),
      save));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const problem = pinProblem(next.value, min);
    if (problem) { status.textContent = problem; next.focus(); return; }
    if (next.value !== again.value) { status.textContent = 'The two new PINs don’t match.'; again.focus(); return; }
    if (!navigator.onLine) { status.textContent = 'Changing your PIN needs an internet connection.'; return; }
    save.disabled = true;
    try {
      await changePin(cur.value, next.value);
      toast('PIN changed.');
      s.close();
    } catch (err) {
      status.textContent = errText(err);
    } finally {
      save.disabled = false;
    }
  });
  const s = sheet(firstTime ? 'Choose your own PIN' : 'Change PIN', form);
  return s;
}

/* ---------------- Account card in Settings ---------------- */
export function accountCard() {
  const me = state.config.me || {};
  return h('div', { class: 'card' },
    h('h3', { style: { marginTop: 0 } }, 'Your account'),
    h('dl', { class: 'kv' },
      h('dt', null, 'Signed in as'), h('dd', null, me.name ? `${me.name} (${me.email})` : '—'),
      h('dt', null, 'Role'), h('dd', null, me.role === 'admin' ? 'Administrator' : 'Family member')),
    me.mustChangePin ? h('div', { class: 'banner warn', style: { marginTop: '10px' } }, 'You are still using the PIN the trip organizer gave you. Consider choosing your own.') : null,
    h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn', onclick: () => openChangePin() }, 'Change PIN'),
      h('button', { class: 'btn', onclick: async () => {
        const unsent = state.queue.length ? ` ${state.queue.length} unsent change(s) will be lost.` : '';
        if (!confirm(`Sign out and erase the trip from this device?${unsent}`)) return;
        await signOut();
        location.hash = '#day';
        toast('Signed out. The trip was erased from this device.');
      } }, 'Sign out and erase this device')),
    h('p', { class: 'small muted' }, 'Signing out removes the trip, unsent changes and saved map areas from this device. Use it before lending or giving away this device.'));
}

/* ---------------- Administrator: people with access ---------------- */
export function adminCard() {
  const box = h('div', { class: 'card', id: 'admin-panel' });
  const list = h('div', null, h('p', { class: 'muted small' }, 'Loading…'));
  const draw = (users) => {
    clear(list);
    if (!users) return;
    users.forEach((u) => list.append(userRow(u, draw)));
  };
  box.append(
    h('h3', { style: { marginTop: 0 } }, 'People with access'),
    h('p', { class: 'small muted' }, 'Only you see this. Add each family member with their email and a starting PIN; they are asked to choose their own PIN when they first sign in.'),
    list,
    h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: () => openAddPerson(draw) }, icon('plus', 18), 'Add a person')));
  if (!navigator.onLine) { clear(list).append(h('p', { class: 'muted small' }, 'Managing access needs an internet connection.')); return box; }
  admin('adminListUsers').then(draw).catch((e) => { clear(list).append(h('p', { class: 'small err' }, errText(e))); });
  return box;
}

function userRow(u, redraw) {
  const status = u.disabled ? 'Blocked (too many wrong PINs)' : u.locked ? 'Locked for 15 min' : u.mustChangePin ? 'Has not chosen own PIN yet' : 'Active';
  const act = (label, fn) => h('button', { class: 'btn small', onclick: fn }, label);
  return h('div', { class: 'item-row', style: { cursor: 'default' } },
    h('span', { class: 'muted' }, icon(u.role === 'admin' ? 'gear' : 'stay', 18)),
    h('div', null,
      h('div', { style: { fontWeight: 600 } }, u.name, u.role === 'admin' ? h('span', { class: 'muted small' }, ' · administrator') : null,
        householdOf(u.name) ? h('span', { class: 'muted small' }, ` · ${householdOf(u.name)}`) : null),
      h('div', { class: 'small muted' }, u.email),
      h('div', { class: 'small' }, status, u.lastSeen ? ` · last seen ${ago(Date.parse(u.lastSeen))}` : ' · never signed in', ` · ${u.devices} device(s)`),
      u.role === 'admin' ? null : h('div', { class: 'row', style: { marginTop: '6px' } },
        act('Reset PIN', () => openResetPin(u, redraw)),
        u.locked || u.disabled ? act('Unlock', async () => { try { redraw(await admin('adminUnlock', { email: u.email })); toast(`${u.name} unlocked.`); } catch (e) { toast(errText(e)); } }) : null,
        act('Remove access', async () => {
          if (!confirm(`Remove ${u.name}'s access? Their devices erase the trip the next time they go online.`)) return;
          try { redraw(await admin('adminRemoveUser', { email: u.email })); toast(`${u.name} removed.`); } catch (e) { toast(errText(e)); }
        }))),
    h('span'));
}

/** Text the administrator sends to a new person (the PIN is best sent separately). */
function inviteText(u, pin) {
  const link = `${location.origin}${location.pathname}#setup=${encodeURIComponent(state.config.url || '')}`;
  return { link, text: `Trip app: ${link}\nSign in with ${u.email}${pin ? ` and PIN ${pin}` : ''}. You'll be asked to choose your own PIN.` };
}

function openAddPerson(redraw) {
  // Only adults get accounts; children are managed by their parents
  const people = state.model.people.filter((p) => !p.child).map((p) => p.name);
  const name = h('select', null, h('option', { value: '' }, 'Choose from the People tab…'), people.map((n) => h('option', { value: n }, n)), h('option', { value: '__other' }, 'Someone else…'));
  const other = h('input', { type: 'text', placeholder: 'Name', class: 'hidden', style: { marginTop: '6px' } });
  name.addEventListener('change', () => other.classList.toggle('hidden', name.value !== '__other'));
  const email = h('input', { type: 'email', inputmode: 'email', autocapitalize: 'none', spellcheck: 'false' });
  const pin = h('input', { type: 'text', inputmode: 'numeric', value: randomPin(6), maxlength: 12, autocomplete: 'off', style: { fontVariantNumeric: 'tabular-nums', letterSpacing: '.1em' } });
  const status = h('div', { class: 'small err', 'aria-live': 'polite' });
  const form = h('form', null,
    h('div', { class: 'field', role: 'group', 'aria-label': 'Name' }, h('span', null, 'Name'), name, other),
    h('label', { class: 'field' }, h('span', null, 'Email'), email),
    h('label', { class: 'field' }, h('span', null, 'Starting PIN ', h('span', { class: 'hint' }, '(6–12 digits; they will be asked to change it)')),
      h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, pin, h('button', { type: 'button', class: 'btn small', onclick: () => { pin.value = randomPin(6); } }, 'New random PIN'))),
    status,
    h('div', { class: 'form-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => s.close() }, 'Close'), h('button', { type: 'submit', class: 'btn primary' }, 'Add')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = name.value === '__other' ? other.value.trim() : name.value;
    if (!n) { status.textContent = 'Choose a name.'; return; }
    const problem = pinProblem(pin.value.trim(), 6);
    if (problem) { status.textContent = problem; return; }
    try {
      const users = await admin('adminAddUser', { email: email.value.trim(), name: n, pin: pin.value.trim() });
      redraw(users);
      s.close();
      showInvite({ name: n, email: email.value.trim().toLowerCase() }, pin.value.trim());
    } catch (err) {
      status.textContent = errText(err);
    }
  });
  const s = sheet('Add a person', form);
}

function openResetPin(u, redraw) {
  const pin = h('input', { type: 'text', inputmode: 'numeric', value: randomPin(6), maxlength: 12, autocomplete: 'off' });
  const status = h('div', { class: 'small err' });
  const form = h('form', null,
    h('p', null, `${u.name} is signed out on all devices (their copy of the trip is erased) and must sign in with this new PIN, then choose their own.`),
    h('label', { class: 'field' }, h('span', null, 'New starting PIN'), pin), status,
    h('div', { class: 'form-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => s.close() }, 'Close'), h('button', { type: 'submit', class: 'btn primary' }, 'Reset PIN')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const problem = pinProblem(pin.value.trim(), 6);
    if (problem) { status.textContent = problem; return; }
    try {
      redraw(await admin('adminResetPin', { email: u.email, pin: pin.value.trim() }));
      s.close();
      showInvite(u, pin.value.trim());
    } catch (err) { status.textContent = errText(err); }
  });
  const s = sheet(`Reset ${u.name}'s PIN`, form);
}

function showInvite(u, pin) {
  const { link } = inviteText(u, pin);
  const copy = (text) => async () => { try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch { toast('Select the text and copy it.'); } };
  const body = h('div', null,
    h('p', null, `Give ${u.name} these, ideally the PIN separately from the rest (in person, by phone, or in a different chat):`),
    h('dl', { class: 'kv' },
      h('dt', null, 'Invite link'), h('dd', null, h('code', { style: { wordBreak: 'break-all' } }, link)),
      h('dt', null, 'Email'), h('dd', null, u.email),
      h('dt', null, 'Starting PIN'), h('dd', null, h('b', { style: { fontSize: '1.2rem', letterSpacing: '.12em' } }, pin))),
    h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn', onclick: copy(inviteText(u).text) }, 'Copy link + email'),
      h('button', { class: 'btn', onclick: copy(pin) }, 'Copy PIN')),
    h('p', { class: 'small muted' }, 'The PIN is not shown again. If it gets lost, use Reset PIN.'));
  const s = sheet(`${u.name} can now sign in`, body);
  return s;
}

const householdOf = (name) => state.model.people.find((p) => p.name.toLowerCase() === String(name).toLowerCase())?.household || '';

/* ---------------- Families (households) ---------------- */
export function familiesCard() {
  const m = state.model;
  const childLabel = (p) => (p.age !== null ? `${p.name} (${p.age})` : p.name);
  const single = m.people.filter((p) => !p.household);
  const edit = (p) => h('button', { class: 'icon-btn', 'aria-label': `Edit ${p.name}`, onclick: () => openEditor('People', p.raw) }, icon('edit', 16));
  return h('div', { class: 'card', id: 'families' },
    h('h3', { style: { marginTop: 0 } }, 'Families'),
    h('p', { class: 'small muted' }, 'Parents and their children form a household. Children don’t sign in; their parents add and change plans for them. A household’s name works in any Who field.'),
    m.households.length ? null : h('p', { class: 'small' }, 'No households yet. Edit a person to put them in one.'),
    m.households.map((hh) => h('div', { class: 'item-row', style: { cursor: 'default' } },
      h('span', { class: 'muted' }, icon('stay', 18)),
      h('div', null,
        h('div', { style: { fontWeight: 600 } }, hh.name),
        h('div', { class: 'small' }, m.partySummary(hh.members)),
        h('div', { class: 'small muted' }, 'Parents/adults: ', hh.adults.join(', ') || '—'),
        h('div', { class: 'small muted' }, 'Children: ', hh.children.map((n) => childLabel(m.peopleByName.get(n))).join(', ') || 'none'),
        h('div', { class: 'chips', style: { marginTop: '6px' } }, hh.members.map((n) => h('span', { class: 'row', style: { gap: '0' } }, personChip(n), edit(m.peopleByName.get(n)))))),
      h('span'))),
    single.length ? h('div', { class: 'small', style: { marginTop: '10px' } }, h('span', { class: 'muted' }, 'Not in a household: '),
      h('span', { class: 'chips', style: { display: 'inline-flex' } }, single.map((p) => h('span', { class: 'row', style: { gap: '0' } }, personChip(p.name), edit(p))))) : null,
    h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn small', onclick: () => openEditor('People') }, icon('plus', 16), 'Add a person (adult or child)')));
}

/* ---------------- Settings page ---------------- */
export function settingsCards() {
  const me = state.config.me || {};
  return [
    h('div', { class: 'card' },
      h('dl', { class: 'kv' },
        h('dt', null, 'Last synced'), h('dd', null, `${fmtJstStamp(state.lastSynced)} (${ago(state.lastSynced)})`),
        h('dt', null, 'Waiting to sync'), h('dd', null, `${state.queue.length} change(s)`),
        h('dt', null, 'Connection'), h('dd', null, state.online ? 'Online' : 'Offline')),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { class: 'btn', onclick: () => sync() }, icon('sync', 18), 'Sync now'),
        me.role === 'admin' && safeUrl(state.data?.sheetUrl) ? h('a', { class: 'btn', href: safeUrl(state.data.sheetUrl), target: '_blank', rel: 'noopener' }, 'Open the Sheet', icon('ext', 14)) : null)),
    accountCard(),
    me.role === 'admin' ? adminCard() : null,
    familiesCard(),
  ];
}
