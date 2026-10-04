# Things to come back to

Open decisions and things that could not be verified while building the app. Itinerary-specific items (gaps in the plan, cities still to choose) are kept in a private Google Doc next to the trip Sheet, not in this repository.

## For the trip organizer to do

- [ ] Everything in Part 2 of [SETUP.md](SETUP.md): turn on Pages, add and deploy the Apps Script, make yourself administrator, add the family.
- [ ] Try the app on a real iPhone and a real Android phone (install, offline, add an entry, sign out).
- [ ] Turn on 2-step verification for the Google and GitHub accounts.

## Design decisions to revisit

- [ ] **Households are empty in the real Sheet.** The People tab's new Household column needs filling in (who belongs with whom, and which adults are each child's parents).
- [ ] **Household names in Who include children.** "Saito family" in Who means both parents and the children. Avoid naming a household "Ken & Yumi", which reads like two adults.
- [ ] **One household per person.** Grandparents travelling with a family are their own household (or none); the "without a parent" check only looks at the child's own household.
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

## Not verified

- [ ] Open-Meteo forecast horizon: 16 days per a search summary of open-meteo.com/en/docs; the page itself was blocked from the build environment. The app does not depend on the number: any date the forecast does not return is shown as "Typical".
- [ ] OpenStreetMap tile policy: a search summary says offline use and prefetching are not permitted on tile.openstreetmap.org, so the app uses OpenFreeMap and caches only tiles a user has viewed. Neither policy page could be opened from the build environment.
- [ ] Open-Meteo, OpenFreeMap and Google Apps Script were unreachable from the build environment, so tests used simulated responses. The first live run is on a real device.
- [ ] iOS Safari was not available for testing; Chromium was used at iPhone and Android screen sizes.
- [ ] iPhone install flow: whether Add to Home Screen keeps the invite link (`#setup=…`) varies by iOS version. The guide tells people to paste the invite link inside the installed app, which works either way.
- [ ] `@OnlyCurrentDoc`, the Sheet menus and the account system were tested against a simulated Apps Script, not a live one. Script Properties limits each value to 9 KB, so each account is stored separately (about 1 KB each); the simulated store enforces that limit.
- [ ] Apps Script quotas (trigger runtime, geocoder calls, URL fetches) were not checked against Google's current quota page. Expected use is small.
- [ ] The GitHub Actions workflow first runs on GitHub with the initial push; publishing needs Pages turned on (SETUP Part 2, step 1).
