# Evolving AI — Seminar Prep

The pre-gathering app for **Evolving AI**, Harvard University, October 8–10, 2026.

A participant enters their details, ranks three of the five focus areas, writes one
question per topic, and gets a pre-read assembled from their choices. The organizer
console turns the submissions into breakout subgroups and printable question sheets.

Everything lives in `docs/` and is a static site — no build step, no server.

```
docs/index.html          the whole app (participant flow + organizer console)
docs/config.js           the one file you edit per deployment
docs/manifest.webmanifest, docs/sw.js, docs/icons/   installable/offline support
docs/sheet-backend.gs    the Google Apps Script that writes to the shared Sheet
```

---

## Run it locally

```bash
npm run dev
```

Then open http://localhost:8787. The organizer console is the button in the top right.

---

## 1. Connect the Google Sheet

Without this, the app still works — submissions stay on the participant's device and in
their personal link, and the organizer console accepts pasted submissions. Connect the
Sheet and submissions land in one place automatically.

1. Create a Google Sheet. Rename the first tab to **Submissions**.
2. **Extensions → Apps Script**. Delete the stub and paste in `docs/sheet-backend.gs`.
3. Change `ADMIN_KEY` to a long random string. Keep it private — you type it into the
   organizer console once; it is never shipped in the app.
4. **Deploy → New deployment → Web app**, with *Execute as:* **Me** and
   *Who has access:* **Anyone**. Authorize when prompted.
   ("Anyone" is what lets a participant submit without a Google login. The endpoint only
   appends submissions; listing the roster requires `ADMIN_KEY`.)
5. Copy the `/exec` URL into `docs/config.js` as `apiUrl`, then redeploy the site.

After any edit to the script, re-deploy as a **new version** or the old code keeps serving.

**Why it works this way:** a static page cannot read an Apps Script response, because
Apps Script sends no CORS headers. So submissions go out as a simple `no-cors` POST and
are then *confirmed* by reading the row back over JSONP, which Apps Script can serve
cross-origin. The app only reports "Saved to the organizers' sheet" once it has read the
row back — it never claims a save it has not verified.

## 2. Deploy the site

Any static host works. This repo publishes from `main` / `/docs`:

```bash
git add -A && git commit -m "Update app" && git push
```

For a Benchmark-controlled URL, point a CNAME at the host and put the domain in
**Settings → Pages → Custom domain**.

## 3. Install it on a phone

Open the URL and use **Add to Home Screen** (iOS Safari: Share → Add to Home Screen;
Android Chrome: it offers "Install app"). It then runs full-screen with its own icon and
works offline after the first load. This is how participants use it before the native
builds exist, and for most of them it is all they will ever need.

## 4. Ship to the App Store and Google Play

The app is wrapped with [Capacitor](https://capacitorjs.com), which loads `docs/` inside a
native shell. The scaffold is committed; the native projects are generated locally
because they need Xcode and Android Studio:

```bash
npm install
npx cap add ios
npx cap add android
npm run cap:sync
npm run cap:ios        # opens Xcode
npm run cap:android    # opens Android Studio
```

Then, in Xcode and Android Studio respectively: set the signing team, bump the version,
archive, and upload.

**What still requires you, and cannot be automated from here:** an Apple Developer
account ($99/yr) and a Google Play developer account ($25 once), the signing
certificates, the store listings and screenshots, a privacy policy URL, and review —
Apple's review is the slow part, and a form-style app with no native functionality is
sometimes rejected under guideline 4.2 ("minimum functionality"). If the stores are a
must-have rather than a nice-to-have, the honest sequence is: ship the installable web
app now, and submit to the stores in parallel.

---

## Organizer console

Top-right button. Nothing here is visible to participants.

- **Roster** — who has submitted, how many questions each has, and the sixth-topic
  proposals. Also accepts pasted submissions for anyone who sends theirs by email.
- **From the sheet** — enter `ADMIN_KEY` and pull every submission. Safe to re-run; it
  replaces the local roster with whatever the Sheet holds.
- **Demand** — interest per topic, weighted 3/2/1 by rank.
- **Subgroups** — three rounds of parallel breakouts. Everyone sits all three of their
  ranked topics, one per round; which topic falls in which round is chosen to open the
  fewest parallel groups, so oversubscribed topics simply run more rooms at once. At
  55–60 participants this lands on 11–12 groups per round of 4–6 people, with both
  communities mixed into every group. A group that cannot be filled is flagged
  *merge or reassign* rather than silently left tiny.
- **Question sheets** — print-ready, one block per group: topic, required reading, the
  members, and every question they submitted. This is what circulates the night before.

## Data

Submissions contain a name, email, affiliation, community, three topic choices and three
questions. They are stored in the Google Sheet you own, in the participant's own browser,
and in the personal link the app gives them. There is no third-party analytics, no
cookies, and no login. The `apiUrl` in `config.js` is public by nature — anyone who reads
the page source can post a submission to it, so treat the Sheet as append-only input and
expect to delete the occasional junk row. `ADMIN_KEY` never leaves the organizer's
browser.

## Reading lists

The per-topic reading lists in `docs/index.html` (the `TOPICS` array) are a proposed set,
not organizer-approved. Each pairs an evolutionary-science source with an AI one. Citations
are author/title/venue/year with no URLs, so they should be checked and linked before the
list goes out.
