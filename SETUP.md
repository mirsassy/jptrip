# Setup

The app is live at **https://mirsassy.github.io/jptrip/**. It shows nothing until the Sheet's script is set up (Part 2, steps 1–4).

Setup is split in two: what is already done, and what only you, the trip organizer, can do. Claude has no access to Apps Script, GitHub repository settings or your phone.

## Part 1: already done

| What | Who | Where |
|---|---|---|
| Added the app's columns to the trip Sheet (ID, Lat/Lng, Last edited by, Attachment on Stays/Transport/Reservations, Address on Restaurant ideas, City Lat/Lng on Lists), city coordinates, and the families as groups (Groups tab) | Claude | The trip Sheet |
| Wrote the app, the Apps Script (`apps-script/Code.gs`), tests and this documentation, including importing bookings from files or pasted text | Claude | This repository |
| Pushed the code to this public repository with no real names, dates, emails or secrets (tests use a made-up family and trip) | Claude | GitHub |
| Set up automatic testing and publishing: every push to `main` runs the tests, then publishes the app | Claude | `.github/workflows/pages.yml` |
| Turned on GitHub Pages; the app is published | You | GitHub → Settings → Pages |
| Moved trip-specific open items to a private document | Claude | "Trip app: private follow-ups" in your Drive's Claude folder |

Claude can do these again later when asked: change the app or the script, push updates (they publish automatically), update the guides, and check the Sheet.

## Part 2: things only you can do

About 25 minutes. Do them in this order.

- [ ] 1. Add the script to the trip Sheet (3 min)
- [ ] 2. Make yourself the administrator (3 min)
- [ ] 3. Turn on automatic location filling (1 min)
- [ ] 4. Publish the script as a web app (3 min)
- [ ] 5. Optional: let the app read bookings with Claude (5 min)
- [ ] 4b. Build the web app address into the app, so people sign in with only email and PIN (2 min)
- [ ] 6. Sign in on your phone (2 min)
- [ ] 7. Add the family (1 min each)
- [ ] 8. Security housekeeping (5 min)
- [ ] 9. Try it on real phones (10 min)

### 1. Add the script to the trip Sheet (3 min)

1. Open the trip Sheet → **Extensions → Apps Script**.
2. In `Code.gs`, delete what is there and paste the whole of [`apps-script/Code.gs`](apps-script/Code.gs).
3. Gear icon (**Project Settings**) → tick **Show "appsscript.json" manifest file in editor**. Open `appsscript.json` and replace it with [`apps-script/appsscript.json`](apps-script/appsscript.json).
4. **Save**. Name the project "Trip app" if asked.

### 2. Make yourself the administrator (3 min)

1. Reload the Sheet tab. A **Trip app** menu appears after a few seconds.
2. **Trip app → Set up the administrator (you)…**
3. Google asks you to authorize the script once:
   - Choose your account.
   - "Google hasn't verified this app" → **Advanced** → **Go to Trip app (unsafe)**. It is your own script; the warning appears for every personal script.
   - **Allow**. The script asks to edit *this* spreadsheet only, see and manage only the Drive files it creates itself (uploaded bookings), connect to external services (Claude, and short Google Maps links) and run when you are not present (for step 3).
4. Run **Trip app → Set up the administrator (you)…** again if the prompts didn't appear. Enter **your email**, **your name** (as in the People tab) and **a PIN of 8 to 12 digits** that only you know.

Only someone who can open the Sheet's menu (only you) can create or replace the administrator. Nobody can make another administrator from the app.

### 3. Turn on automatic location filling (1 min)

**Trip app → Turn on automatic location filling.** Every 15 minutes the script gives new rows an ID and looks up map coordinates for addresses typed into the Sheet.

### 4. Publish the script as a web app (3 min)

1. In the Apps Script editor: **Deploy → New deployment** → gear next to "Select type" → **Web app**.
2. Description `Trip app`; **Execute as: Me**; **Who has access: Anyone**.
   "Anyone" is needed because family members are not signed in to your Google account; their email and PIN are what protect the data.
3. **Deploy** → copy the **Web app URL** (ends in `/exec`). Keep it private; it is not secret on its own, but there is no reason to post it.

After any later change to `Code.gs`: **Deploy → Manage deployments → pencil → Version: New version → Deploy** (the URL stays the same).

#### 4b. Build the address into the app (2 min)

So nobody has to paste the Web app URL:

1. Open https://github.com/mirsassy/jptrip → **Settings → Secrets and variables → Actions → Variables** tab → **New repository variable**.
2. Name `TRIP_SCRIPT_URL`, value: the Web app URL (ends in `/exec`). **Add variable**.
3. **Actions** tab → **Test and deploy to GitHub Pages** → **Run workflow** (or ask Claude to push any change). When it is green, the sign-in screen shows only Email and PIN, and invites are just the app address.

Trade-off: the address becomes readable by anyone who inspects the published app. It does not open the data (that still needs an email and PIN, with lockout after wrong PINs), but someone who knows a family member's email could lock that account for 15 minutes by guessing. Without this step, the app keeps asking for the invite link.

### 5. Optional: let the app read bookings with Claude (5 min)

The **+ → Import from a file or pasted text** button sends a confirmation email, PDF or screenshot to Claude, which fills in the forms. It needs an Anthropic API key, which is paid per use: roughly 2–10 US cents per document. Skip this step and the button tells people it is not turned on.

1. Go to https://console.anthropic.com, sign in or create an account, add a payment method.
2. **Settings → Limits**: set a low **monthly spend limit** (for example $10).
3. **API keys → Create key**, name it "Trip app", copy it (starts with `sk-ant-`).
4. In the Sheet: **Trip app → Set the Claude API key (reading bookings)…**, paste it, OK. No new deployment is needed for this.

The key stays in the script's settings; it is never sent to phones. Each person can read up to 40 documents a day. **Trip app → Turn off reading bookings with Claude** removes the key.

Uploaded files are kept in a Drive folder named **Trip app uploads**, created the first time someone keeps a file. It is shared with nobody; family members open files through the app. Move that folder into your **Claude** folder when it appears (the app keeps working after the move).

### 6. Sign in on your phone (2 min)

1. Open the app address on your phone.
2. Enter your email and administrator PIN, tap **Sign in**. (Without step 4b, first paste the Web app URL into **Invite link**.)
3. iPhone: **Share → Add to Home Screen**, open it from the home screen, and sign in once more there (iPhone keeps home-screen apps separate from Safari). Android: tap **Install** when Chrome offers it.

### 7. Add the family (1 min each)

First, put each family in a group: in the Sheet (Groups tab: group name, then members such as "Ken, Yumi, Aiko") or in the app (**Settings → Groups → Add a group**). A child's parents are the adults in the same group. Put a child's age in their Notes ("Age 7"). "Everyone" is automatic: it always means the whole People tab.

Then give each adult a sign-in. Children don't get one; their parents add and change things for them.

1. In the app: **Settings → People with access → Add a person**. Pick their name (adults only), type their email, keep or change the random starting PIN, tap **Add**.
2. The app shows an invite link, their email and the PIN. Send the link and email in one message and the **PIN separately** (in person, by phone, or in a different chat).
3. Send them the family guide ([docs/FAMILY-GUIDE.md](docs/FAMILY-GUIDE.md) or the published guide page). When they first sign in, they are offered the chance to choose their own PIN.

From the same panel you can **Reset PIN** (signs that person out everywhere), **Unlock** (after too many wrong PINs) and **Remove access** (their devices erase the trip the next time they go online).

### 8. Security housekeeping (5 min)

- Turn on **2-step verification** for your Google and GitHub accounts. Whoever controls them controls the Sheet and the app.
- The old repository `mirsassy/Japan` (and its pull request #1) still contains earlier versions with real names and dates in its history. It is private now; keep it that way, or delete it once this app is working for you (**Settings → General → Danger Zone → Delete this repository**). Claude cannot delete repositories.
- Keep passport numbers and payment details out of the Sheet.

### 9. Try it on real phones (10 min)

On one iPhone and one Android phone: install, sign in, add a note, turn on airplane mode and check the app still opens with the trip, turn it off and check the note reached the Sheet, then **Settings → Sign out and erase this device**. If you did step 5, also import one real confirmation email and one PDF, and check the dates, times and Who before adding.

## If something goes wrong

| Symptom | Fix |
|---|---|
| "The Sheet sent an unexpected reply" | The URL is not the `/exec` Web app URL, or the deployment's access is not "Anyone". Redo step 4. |
| "The app has no administrator yet" | Do step 2. |
| "That email and PIN don't match" | Check both. As administrator, check **Settings → People with access** for their email. |
| "Too many wrong PINs" | Wait 15 minutes, or use **Unlock** in People with access. After 10 wrong PINs the account stays blocked until you unlock it or reset the PIN. |
| You forgot the administrator PIN | Run **Trip app → Set up the administrator (you)…** again in the Sheet. |
| Rows typed in the Sheet have no map pin | **Trip app → Fill IDs and map locations now**, or paste a Google Maps link into the row's location in the app. |
| You changed `Code.gs` but nothing changed | Deploy a **New version** (step 4). |
| "Reading bookings is not turned on yet" | Do step 5. |
| "The Claude API key in the Sheet is not working" | Make a new key in the Anthropic console and set it again (step 5). Also check the account has credit. |
| After updating the script, Google asks for permission again | Expected when the script needs a new permission (for example Drive for uploads). Allow it, then deploy a new version. |
| The app didn't update after a push | Check the Actions tab is green; then on the phone tap **Reload** on the "new version" banner. |
