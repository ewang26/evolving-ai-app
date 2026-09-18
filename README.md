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

## The Google Sheet (already connected)

Submissions land in **Evolving AI — Seminar Prep Submissions** in Erik's Drive, one row
per participant keyed on email, via a deployed Apps Script web app. This is live; there is
nothing to set up.

| | |
| --- | --- |
| Sheet | `1QZJrNvhEIPk0XVnM6l1YtBPbJNh1hhn8RTpLXnj8HcY` |
| Script project | "Evolving AI - submissions endpoint" (standalone, in the same Drive) |
| Endpoint | set as `apiUrl` in `docs/config.js` |
| Deployment | Execute as: Erik · Who has access: **Anyone** (anonymous submissions) |
| Admin key | in the script as `ADMIN_KEY`; deliberately **not** in this repo |

The organizer console's **From the sheet** tab asks for that admin key and pulls the whole
roster. The key is stored only in that browser.

**Why it is built this way:** a static page cannot read an Apps Script response, because
Apps Script sends no CORS headers. So a submission goes out as a simple `no-cors` POST and
is then *confirmed* by reading the row back over JSONP, which Apps Script can serve
cross-origin. The app only reports "Saved to the organizers' sheet" once it has actually
read the row back, so a silent failure shows as "Saved on this device" plus a retry rather
than a false success.

**To rotate the admin key:** open the script project, change `ADMIN_KEY`, then
Deploy → Manage deployments → edit → Version: **New version**. Editing without
re-deploying changes nothing, because the web app serves the deployed version.

**To move the endpoint** (new Google account, or a fresh deployment): paste
`docs/sheet-backend.gs` into a new Apps Script project, set `SHEET_ID` and `ADMIN_KEY`,
deploy as a web app with access **Anyone**, and put the `/exec` URL in `docs/config.js`.

**Abuse surface:** `apiUrl` is public by nature — anyone reading the page source can POST
a submission. The endpoint only appends or updates rows and never returns the roster
without the key, so the worst case is junk rows to delete.

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

- **Roster** — who has submitted and how many questions each has. Also accepts pasted
  submissions for anyone who sends theirs by email.
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

Two papers per focus area, in the `TOPICS` array in `docs/index.html`. Each citation links
straight to a PDF, and every link was checked to resolve to the right paper before shipping:
the seven arXiv items by matching `citation_title` on the abstract page, Ostrom's Nobel
lecture by extracting its text, and the PNAS and Royal Society PDFs by loading them in a
real browser (both bot-block command-line requests but serve the file to a person).

Page counts come from the PDFs themselves. The Aktipis paper shows no page count because
its Crossref record carries an article number rather than a page range — better a missing
chip than an invented figure.

The PDFs are linked, not re-hosted: the arXiv and Nobel items could be mirrored, but the
PNAS and Royal Society papers are publisher copyright and should not be redistributed from
a public site.

The selection is still a proposal, not organizer-approved. Each area pairs an
evolutionary-science source with an AI one, except **Steering Open-Ended AI Ecosystems**,
where both are AI papers because that is where the literature is.
