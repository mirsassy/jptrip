# Trip planner

A family trip planner for Japan that runs on phones and desktops, works offline, and uses a Google Sheet as its only data store.

**App:** https://mirsassy.github.io/jptrip/ (after [setup](SETUP.md)) · **Family guide:** [docs/FAMILY-GUIDE.md](docs/FAMILY-GUIDE.md) · **Open items:** [FOLLOW-UPS.md](FOLLOW-UPS.md)

## What it does

- **Day view**: for a chosen date, the family is split into ad hoc groups by where each person sleeps that night. Each group gets its stay, check-out/check-in, transport, reservations and notes in time order, plus the weather for every city they are in that day. It opens on today during the trip, and on the first trip day before it.
- **Map**: pins for stays, transport endpoints, reservations, notes and restaurant ideas, colored by the people involved (People tab colors). A day slider shows where everyone is. Every pin links to Google Maps and Apple Maps.
- **Filters** by person, group, city, type, status and date range, remembered on each device. Cancelled rows only show when the Cancelled status is selected.
- **Weather**: daily high/low in °F and chance of rain from [Open-Meteo](https://open-meteo.com). Dates the forecast covers are labeled **Forecast**. Other dates show **Typical**: the 10-year average for that date (±3 days) from Open-Meteo's historical archive, with "rain on X% of days" instead of a chance of rain.
- **Checks**: a child booked with no adult or without a parent (an adult who shares a group with them), a party size that differs from Who, a person in two places at overlapping times, two stays on one night, a night with no stay (overnight trains/flights excepted), a reservation in a city the person isn't in that day, cancellation deadlines in the next 72 hours, and Sheet rows with unknown names or unreadable dates.
- **Groups and families**: the People tab's Group column puts people in groups (for example a family: parents and their children; several groups allowed, comma-separated). A group name works in any Who field; "Everyone" always means the whole People tab and is used only when everyone is picked. Reservations show "4 adults, 2 children (7, 3)" and fill in their party size from Who; children have no sign-in: their parents act for them.
- **Month view**: a calendar of the trip showing, for each night, the city where people sleep and who is there, plus a list of every stay. Tap a day to open it.
- **Day view** items show their type, place, people and a Google Maps link (directions for transport); notes and booking details are in each item's form.
- **Forms** for every tab, with dropdowns from the Lists and People tabs, and one-tap **Move to Reservations** for restaurant ideas. Stays, transport and reservations require choosing **Who** is going.
- **Import**: paste a confirmation email or upload a PDF, photo or screenshot; Claude (Anthropic's API, called by the Sheet's script) reads it and each booking opens in its form, pre-filled, for a person to check, choose Who and add. The file can be kept with the booking (an **Attachment** link) in a private Drive folder and opened from the app. Optional; needs an API key (see [SETUP.md](SETUP.md#5-optional-let-the-app-read-bookings-with-claude-5-min)).
- **Offline**: the app, the latest data and weather are kept on the device; edits made offline are queued and sent when back online. The top bar shows when it last synced.

Dates are never hard-coded: the trip range is derived from the earliest and latest dates in the Sheet.

## How it fits together

```
 Phone / desktop browser (installable PWA, GitHub Pages)
   ├─ IndexedDB: Sheet data, edit queue, weather       ├─ Service worker: app files + viewed map tiles
   │
   ├─ POST (text/plain JSON + session token) ──► Apps Script web app, bound to the Sheet ──► Google Sheet
   │                                                  ├──► api.anthropic.com  (import: reads bookings; key kept in the script)
   │                                                  └──► Google Drive       (uploaded files, "Trip app uploads" folder only)
   ├─ GET ──► api.open-meteo.com / archive-api.open-meteo.com   (weather, no key)
   └─ GET ──► tiles.openfreemap.org                             (map, no key)
```

| Path | What |
|---|---|
| `apps-script/Code.gs` | The Sheet API: read all tabs, add/update rows, move an idea to Reservations, add a Lists value, resolve pasted map links, geocode addresses once and store Lat/Lng in the Sheet, read bookings with Claude, keep and serve uploaded files. Also the Sheet's **Trip app** menu and triggers. |
| `src/lib/` | App logic without UI: dates (Japan time), the data model and Who resolution, filters, conflict checks, weather, API client, store (cache, sync, offline queue). |
| `src/ui/` | Views: Day, Map, List, Ideas, Issues, Settings, forms. |
| `src/sw-template.js` | Service worker (file list injected at build). |
| `dev/` | `gas-fake.mjs` runs the real `Code.gs` under Node against an in-memory copy of the Sheet; `mock-server.mjs` serves it over HTTP for local development and tests. |
| `tests/` | Unit tests (Vitest) and browser tests (Playwright). |

### Sheet conventions the app relies on

From the Sheet's **How to use** tab: comma-separated **Who** (group names and/or people, groups coming from the People tab's Group column; a blank Who means everyone), Status = Idea / Tentative / Confirmed / Cancelled, all times in Japan local time. Columns the app added at the end of tabs: `ID`, `Lat`, `Lng` (`From/To Lat/Lng` on Transport), `Last edited by`, `Attachment` (a Drive link to an uploaded file) on Stays, Transport and Reservations, `Address` on Restaurant ideas, `Household` on People, and `City Lat` / `City Lng` on Lists. A child's age is read from their Notes ("Age 7"). See [FOLLOW-UPS.md](FOLLOW-UPS.md). Editing in the Sheet directly keeps working: the app reads the whole Sheet on every sync, and the Sheet assigns IDs and looks up coordinates for typed rows.

Only the fields someone actually changed are sent on save, so two people editing different fields of the same row don't overwrite each other. If two people change the same field, the later save wins.

## Security and privacy

The trip data lives only in a private Google Sheet (shared with nobody). The app reaches it through an Apps Script web app that runs as the Sheet owner. People sign in with **email and PIN**; the device then keeps a random session token, never the PIN.

| Protection | How |
|---|---|
| One administrator | Created only from the Sheet's **Trip app** menu, so only the Sheet owner can make or replace it. The app cannot create administrators. Administrator PIN: 8–12 digits. |
| Accounts made by the administrator | In the app: **Settings → People with access** (add with email, name and starting PIN; reset PIN; unlock; remove). Only adults can have accounts: the script refuses anyone the People tab lists as a child. |
| Own PIN | On first sign-in people are offered to replace the starting PIN with their own (6–12 digits, no repeats or runs like 123456). Changing it signs out their other devices. |
| Guessing PINs | 5 wrong PINs in a row lock the account for 15 minutes; 10 block it until the administrator unlocks it. Wrong attempts also cost 1.5 s each. An unknown email and a wrong PIN get the same answer. |
| Stored safely | PINs (salted) and session tokens are stored only as SHA-256 hashes in Script Properties. |
| Sessions | Up to 5 signed-in devices per person; a device unused for 30 days must sign in again. |
| Trustworthy "Last edited by" | Set by the script from the signed-in account, not from anything the app sends. |
| Removing access | Remove or PIN reset ends that person's sessions; their devices erase the trip, unsent changes and saved map areas at the next sync. |
| Script limited to this Sheet | The manifest asks for this spreadsheet only (`spreadsheets.currentonly`) and Drive's `drive.file`: the script sees only files it created (uploads), not the rest of the Drive. |
| Claude API key | Set from the Sheet menu and kept in Script Properties; never sent to the app or stored in the repo. Requests to Claude come from the script, not from phones. Each person can read 40 documents a day. |
| Uploaded files | In a "Trip app uploads" Drive folder shared with nobody. The app's "attachment" request serves only files inside that folder, and only to signed-in people. A file nobody added a booking from is moved to the Drive trash. |
| App can't leak data elsewhere | A Content-Security-Policy allows scripts only from the app itself and network requests only to Apps Script, Open-Meteo and OpenFreeMap. |
| No HTML or formula injection | Sheet text is always shown as text, only http(s) links are clickable, and text from the app is never written as a formula. |
| Sign out | **Settings → Sign out and erase this device** ends the session on the server and erases the device. |
| Nothing secret in the repo | No PINs, tokens or Apps Script URL. Tests use a made-up family and itinerary. |

What it does not protect against:
- **An unlocked phone.** The app keeps a copy of the trip on each device so it works offline. Phone screen locks matter.
- **A shared PIN.** Anyone with someone's email and PIN can sign in as them, so PINs go to one person each, separately from the invite link.
- **The Google and GitHub accounts.** Whoever controls them controls the Sheet and the app. Use 2-step verification.
- **Third parties.** Google stores the Sheet. Open-Meteo sees city coordinates and OpenFreeMap sees which map areas are viewed (plus the device's IP address); neither sees names or bookings. **Anthropic** sees whatever is imported (a booking usually includes the guests' names) plus the trip dates and the Lists cities, modes and types; the People tab is not sent. Per Anthropic's commercial terms, API data is not used for training (not re-checked from here; see FOLLOW-UPS).
- **Short PIN hashes.** If someone could read the script's properties (only the Sheet owner can), 6-digit PINs could be guessed offline. That person already owns the data.

Per-person Google sign-in was considered and not used: it needs a Google Cloud OAuth setup, shows "unverified app" warnings to every family member, and sign-in is unreliable inside iPhone home-screen apps.

## Hosting and free services

| Service | Use | Notes |
|---|---|---|
| GitHub Pages | Hosts the app | Free for public repos. Deployed by `.github/workflows/pages.yml` on every push to `main`, after the tests pass. |
| Google Apps Script | Sheet API, geocoding | Runs under the Sheet owner's Google account quotas. |
| Anthropic Claude API | Reading imported bookings (optional) | **Paid** per use, about 2–10 US cents per document with `claude-opus-5-5`. Set a monthly spend limit in the Anthropic console. If the model declines a document, the request is retried on Anthropic's recommended fallback model (`fallbacks: "default"`). |
| Open-Meteo | Forecast and historical weather | Free for non-commercial use, no key. The app asks for 16 forecast days and treats any date not returned as "typical". |
| OpenFreeMap | Map style and vector tiles | Free, no key, no request limits per its site. Chosen over tile.openstreetmap.org, whose usage policy forbids offline use and prefetching. The service worker caches only tiles the user has viewed (up to 4,000 files), never areas in advance. |

## iPhone and Android notes

- **iPhone (Safari):** no install prompt. People use **Share → Add to Home Screen**.
  - The home-screen app keeps its own storage, separate from Safari, so each person connects once inside the installed app (pasting the invite link works).
  - iOS has no background sync: edits made offline are sent the next time the app is opened online, not while it is closed.
  - iOS may clear a home-screen app's data if it goes unused for weeks; the app then reloads everything from the Sheet when online.
- **Android (Chrome):** Chrome offers **Install**, and the installed app shares storage with Chrome. Queued edits are also sent when the app is next opened.
- Map links open the Google Maps or Apple Maps app when installed.

## Development

```bash
npm install
npm run mock          # local stand-in for the Apps Script web app (sign in: avery@example.com, PIN 24681357)
npm run dev           # app at http://localhost:5173 — invite link: http://localhost:8787
npm test              # unit tests: Code.gs (via the fake), model, filters, conflicts, weather
npm run e2e           # Playwright: iPhone-size, Android-size and desktop Chromium, incl. offline
npm run build         # production build in dist/
```

Updating the Apps Script after changing `apps-script/Code.gs`: paste it into the Sheet's script editor and deploy a new version (see [SETUP.md](SETUP.md#4-publish-the-script-as-a-web-app)).

## What was and wasn't tested

Tested here: the real `Code.gs` logic (including accounts, PINs, lockout and sessions) against a simulated Sheet, all app logic, and the full app in Chromium at iPhone and Android screen sizes and on desktop: installability, offline start-up, offline edits syncing later, reuse of cached map files, sign-in, first-sign-in PIN change, lockout, the administrator panel, erase on sign-out and on removed access, importing pasted text and files (against a simulated Claude and Drive), and the security policy blocking other sites.

Not tested here (see [FOLLOW-UPS.md](FOLLOW-UPS.md)): real iOS Safari and Android devices, the live Apps Script deployment, and live Open-Meteo and OpenFreeMap responses (the build environment could not reach them, so tests used recorded-format stand-ins).
