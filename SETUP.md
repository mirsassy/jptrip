# Setup

The app's address once published: **https://mirsassy.github.io/jptrip/**

Setup is split in two: what Claude has done (or can do when asked), and what only you, the trip organizer, can do. Claude has no access to Apps Script, GitHub repository settings or your phone.

## Part 1: done by Claude

| What | Where |
|---|---|
| Added the app's columns to the trip Sheet (ID, Lat/Lng, Last edited by, Attachment on Stays/Transport/Reservations, Address on Restaurant ideas, Household on People, City Lat/Lng on Lists) and city coordinates | The trip Sheet |
| Wrote the app, the Apps Script (`apps-script/Code.gs`), tests and this documentation | This repository |
| Pushed the code to this public repository (which you created) as one clean commit: code, a made-up test family and trip, no real names, dates, emails or secrets | GitHub |
| Set up automatic testing and publishing: every push to `main` runs the tests, then publishes the app to GitHub Pages | `.github/workflows/pages.yml` |
| Moved trip-specific open items to a private document | "Trip app: private follow-ups" in your Drive's Claude folder |

Claude can do these again later when asked: change the app or the script, push updates (they publish automatically), update the guides, and check the Sheet.

## Part 2: things only you can do

About 20 minutes. Do them in this order.

### 1. Turn on GitHub Pages (2 min)

1. Open https://github.com/mirsassy/jptrip → **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Open the **Actions** tab → the latest **Test and deploy to GitHub Pages** run → **Re-run all jobs**. (The first run could not publish because Pages was off.) When it is green, the app is live at the address above.

### 2. Add the script to the trip Sheet (3 min)

1. Open the trip Sheet → **Extensions → Apps Script**.
2. In `Code.gs`, delete what is there and paste the whole of [`apps-script/Code.gs`](apps-script/Code.gs).
3. Gear icon (**Project Settings**) → tick **Show "appsscript.json" manifest file in editor**. Open `appsscript.json` and replace it with [`apps-script/appsscript.json`](apps-script/appsscript.json).
4. **Save**. Name the project "Trip app" if asked.

### 3. Make yourself the administrator (3 min)

1. Reload the Sheet tab. A **Trip app** menu appears after a few seconds.
2. **Trip app → Set up the administrator (you)…**
3. Google asks you to authorize the script once:
   - Choose your account.
   - "Google hasn't verified this app" → **Advanced** → **Go to Trip app (unsafe)**. It is your own script; the warning appears for every personal script.
   - **Allow**. The script asks to edit *this* spreadsheet only, see and manage only the Drive files it creates itself (uploaded bookings), connect to external services (Claude, and short Google Maps links) and run when you are not present (for step 4).
4. Run **Trip app → Set up the administrator (you)…** again if the prompts didn't appear. Enter **your email**, **your name** (as in the People tab) and **a PIN of 8 to 12 digits** that only you know.

Only someone who can open the Sheet's menu (only you) can create or replace the administrator. Nobody can make another administrator from the app.

### 4. Turn on automatic location filling (1 min)

**Trip app → Turn on automatic location filling.** Every 15 minutes the script gives new rows an ID and looks up map coordinates for addresses typed into the Sheet.

### 4b. Optional: let the app read bookings with Claude (5 min)

The **+ → Import from a file or pasted text** button sends a confirmation email, PDF or screenshot to Claude, which fills in the forms. It needs an Anthropic API key, which is paid per use: roughly 2–10 US cents per document. Skip this step and the button tells people it is not turned on.

1. Go to https://console.anthropic.com, sign in or create an account, add a payment method.
2. **Settings → Limits**: set a low **monthly spend limit** (for example $10).
3. **API keys → Create key**, name it "Trip app", copy it (starts with `sk-ant-`).
4. In the Sheet: **Trip app → Set the Claude API key (reading bookings)…**, paste it, OK.

The key stays in the script's settings; it is never sent to phones. Each person can read up to 40 documents a day. **Trip app → Turn off reading bookings with Claude** removes the key.

Uploaded files are kept in a Drive folder named **Trip app uploads**, created the first time someone keeps a file. It is shared with nobody; family members open files through the app. Move that folder into your **Claude** folder when it appears (the app keeps working after the move).

### 5. Publish the script as a web app (3 min)

1. In the Apps Script editor: **Deploy → New deployment** → gear next to "Select type" → **Web app**.
2. Description `Trip app`; **Execute as: Me**; **Who has access: Anyone**.
   "Anyone" is needed because family members are not signed in to your Google account; their email and PIN are what protect the data.
3. **Deploy** → copy the **Web app URL** (ends in `/exec`). Keep it private; it is not secret on its own, but there is no reason to post it.

After any later change to `Code.gs`: **Deploy → Manage deployments → pencil → Version: New version → Deploy** (the URL stays the same).

### 6. Sign in on your phone (2 min)

1. Open the app address on your phone.
2. Paste the Web app URL into **Invite link**, enter your email and administrator PIN, tap **Sign in**.
3. iPhone: **Share → Add to Home Screen**, open it from the home screen, and sign in once more there (iPhone keeps home-screen apps separate from Safari). Android: tap **Install** when Chrome offers it.

### 7. Add the family (1 min each)

First, group people into households, either in the Sheet (People tab, **Household** column, e.g. "Saito family" for both parents and their children) or in the app (**Settings → Families**, pencil next to a person). Name households like "Saito family" rather than "Ken & Yumi": a household's name in a Who field includes its children. Put a child's age in their Notes ("Age 7").

Then give each adult a sign-in. Children don't get one; their parents add and change things for them.

1. In the app: **Settings → People with access → Add a person**. Pick their name (adults only), type their email, keep or change the random starting PIN, tap **Add**.
2. The app shows an invite link, their email and the PIN. Send the link and email in one message and the **PIN separately** (in person, by phone, or in a different chat).
3. Send them the family guide ([docs/FAMILY-GUIDE.md](docs/FAMILY-GUIDE.md) or the published guide page). When they first sign in, they are offered the chance to choose their own PIN.

From the same panel you can **Reset PIN** (signs that person out everywhere), **Unlock** (after too many wrong PINs) and **Remove access** (their devices erase the trip the next time they go online).

### 8. Security housekeeping (5 min)

- Turn on **2-step verification** for your Google and GitHub accounts. Whoever controls them controls the Sheet and the app.
- The old repository `mirsassy/Japan` (and its pull request #1) still contains earlier versions with real names and dates in its history. Keep it **private**, or delete it once this repository is working (**Settings → General → Danger Zone → Delete this repository**). Claude cannot delete repositories.
- Keep passport numbers and payment details out of the Sheet.

### 9. Try it on real phones (10 min)

On one iPhone and one Android phone: install, sign in, add a note, turn on airplane mode and check the app still opens with the trip, turn it off and check the note reached the Sheet, then **Settings → Sign out and erase this device**.

## If something goes wrong

| Symptom | Fix |
|---|---|
| "The Sheet sent an unexpected reply" | The URL is not the `/exec` Web app URL, or the deployment's access is not "Anyone". Redo step 5. |
| "The app has no administrator yet" | Do step 3. |
| "That email and PIN don't match" | Check both. As administrator, check **Settings → People with access** for their email. |
| "Too many wrong PINs" | Wait 15 minutes, or use **Unlock** in People with access. After 10 wrong PINs the account stays blocked until you unlock it or reset the PIN. |
| You forgot the administrator PIN | Run **Trip app → Set up the administrator (you)…** again in the Sheet. |
| Rows typed in the Sheet have no map pin | **Trip app → Fill IDs and map locations now**, or paste a Google Maps link into the row's location in the app. |
| You changed `Code.gs` but nothing changed | Deploy a **New version** (step 5). |
| "Reading bookings is not turned on yet" | Do step 4b. |
| "The Claude API key in the Sheet is not working" | Make a new key in the Anthropic console and set it again (step 4b). Also check the account has credit. |
| After updating the script, Google asks for permission again | Expected when the script needs a new permission (for example Drive for uploads). Allow it, then deploy a new version. |
| The app didn't update after a push | Check the Actions tab is green; then on the phone tap **Reload** on the "new version" banner. |
