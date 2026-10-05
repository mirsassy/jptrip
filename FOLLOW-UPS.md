# Things to come back to

Open decisions and things that could not be verified while building the app. Itinerary-specific items (gaps in the plan, cities still to choose) are kept in a private Google Doc next to the trip Sheet, not in this repository.

## For the trip organizer to do

- [ ] **Update the Sheet's script again** (needed for Settings → Trip dates): paste the new `apps-script/Code.gs`, Save, then Deploy → Manage deployments → pencil → New version → Deploy.
- [ ] **Update the Sheet's script** (needed for the Ideas tab): paste the new `apps-script/Code.gs` and `apps-script/appsscript.json` into Extensions → Apps Script, Save, then Deploy → Manage deployments → pencil → New version → Deploy. Then Trip app → Fill IDs and map locations now (repeat until all ideas have pins; it does about 100 per run).
- [x] Turn on GitHub Pages (done; the app is published).
- [x] Build the web app address into the app (GitHub variable TRIP_SCRIPT_URL; done).
- [ ] Everything in Part 2 of [SETUP.md](SETUP.md): add and deploy the Apps Script, make yourself administrator, add the family.
- [ ] Turn on 2-step verification for the Google and GitHub accounts.
- [ ] Optional: create an Anthropic API key with a spend limit and set it from the Sheet menu (SETUP step 5).

## Come back to

- [x] **Saving an uploaded file failed** (403 from Drive). Resolved by removing file saving: files are only read.

## Design decisions to revisit

- [ ] **Groups live in the People tab** (Group column; several allowed, comma-separated). The Groups tab is gone. A child's parents are the adults who share a group with them; "Everyone" is always the whole People tab.

- [ ] **Children's ages** come from the People tab Notes ("Age 7").
- [ ] **Party size fills in from Who** only when left blank; a different number is kept and flagged under Issues.

- [ ] **Reservation length.** Reservations have only a start time, so overlap checks assume each lasts 2 hours.
- [ ] **"Move to Reservations".** The app creates the reservation and sets the idea's Status to Confirmed, adding "Moved to Reservations" to its Notes. It does not delete the idea row.
- [ ] **No delete button.** The How to use tab says to keep cancelled rows, so the app sets Status to Cancelled instead of deleting. Rows can still be deleted in the Sheet.
- [ ] **After the trip** the Day view defaults to the last trip day.
- [ ] **Blank Who means everyone.** A row with an empty Who column is treated as the whole family.
- [ ] **Same-field edits.** Only changed fields are sent, but if two people change the same field of the same row, the later save wins.
- [ ] **Night grouping.** If someone has two stays on one night (a conflict), the Day view groups them by the one with fewer people, and the Issues tab flags it.
- [ ] **Removed access erases the phone's copy** at its next sync, including any changes it had not sent yet. A PIN reset by the administrator does the same.
- [ ] **Choosing your own PIN is offered, not required.** First sign-in shows the prompt with "Not now"; Settings keeps reminding. It could be made mandatory.
- [ ] **Lockout reveals an account exists** after 5 wrong PINs (the "locked" message). Unknown emails and wrong PINs otherwise get the same answer.
- [ ] **Administrator recovery** is from the Sheet menu only (Set up the administrator again).
- [ ] **Who is required** for stays, transport and reservations in the app's forms (not for notes or ideas). Rows typed in the Sheet can still leave Who blank, which means everyone; editing such a row in the app asks for Who.
- [ ] **Import is reviewed, never automatic.** Each booking Claude finds opens in its form; nothing is added until someone taps Add. Guest names are matched to People by name; unmatched names are listed.
- [ ] **Ideas tab** comes from a separate research agent. The app reads its columns as named (Name … Notes) and adds ID, Lat, Lng, Last edited by at the end; keep those four at the end if the agent rewrites the tab. "Book" sets the idea's Status to Confirmed.
- [ ] **Times in other time zones** (e.g. a flight departing the US) are converted to Japan time by Claude, with the original noted; worth checking on import.
- [ ] **Claude model and effort**: `claude-opus-5-5` at effort "low" to keep each read fast and cheap. A cheaper model could be used if cost matters.

## Not verified

- [ ] Open-Meteo forecast horizon: 16 days per a search summary of open-meteo.com/en/docs; the page itself was blocked from the build environment. The app does not depend on the number: any date the forecast does not return is shown as "Typical".
- [ ] OpenStreetMap tile policy: a search summary says offline use and prefetching are not permitted on tile.openstreetmap.org, so the app uses OpenFreeMap and caches only tiles a user has viewed. Neither policy page could be opened from the build environment.
- [ ] Open-Meteo, OpenFreeMap and Google Apps Script were unreachable from the build environment, so tests used simulated responses. The first live run is on a real device.
- [ ] iOS Safari was not available for testing; Chromium was used at iPhone and Android screen sizes.
- [ ] iPhone install flow: whether Add to Home Screen keeps the invite link (`#setup=…`) varies by iOS version. The guide tells people to paste the invite link inside the installed app, which works either way.
- [ ] `@OnlyCurrentDoc`, the Sheet menus and the account system were tested against a simulated Apps Script, not a live one. Script Properties limits each value to 9 KB, so each account is stored separately (about 1 KB each); the simulated store enforces that limit.
- [ ] Apps Script quotas (trigger runtime, geocoder calls, URL fetches) were not checked against Google's current quota page. Expected use is small.
- [ ] **Import was tested against a simulated Claude API**, not the live services: the request shape (structured outputs, `fallbacks: "default"` with the `server-side-fallback-2026-07-01` header, PDF/image blocks) follows Anthropic's documentation but has not been sent for real.
- [ ] **Apps Script limits for import**: how long UrlFetchApp waits for a reply (Claude can take 10–60 s) and the largest request a web app accepts were not checked against Google's quota page. Files are capped at 8 MB.
- [ ] **Geocoding after the manifest change**: the manifest now lists its permissions explicitly. The Maps geocoder is believed to need none of its own; if map pins stop being filled in after the update, that is the first thing to check.
- [ ] **Anthropic data use**: that API inputs are not used for training is from memory of Anthropic's commercial terms, not re-checked from here.
