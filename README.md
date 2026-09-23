# Evolving AI — Seminar Prep

The pre-gathering app for **Evolving AI**, Harvard University, October 8–10, 2026.

A participant enters their details, ranks three of the six focus areas, reads the pre-read
assembled from those choices, then writes one question per topic plus an optional proposal
for another. The organizer
console turns the submissions into breakout subgroups and printable question sheets.

Everything lives in `docs/` and is a static site — no build step, no server.

```
docs/index.html          the whole app (participant flow + organizer console)
docs/config.js           compatibility config for older app pages
docs/manifest.webmanifest, docs/sw.js, docs/icons/   installable/offline support
docs/sheet-backend.gs    the Google Apps Script that writes to the shared Sheet
```

---

## Run it locally

```bash
npm run dev
```

Then open http://localhost:8787. Add `#organizer` to the URL to open the organizer console.

---

## The Google Sheet (already connected)

Submissions land in **Evolving AI — Seminar Prep Submissions** in Erik's Drive, one row
per participant keyed on email, via a deployed Apps Script web app. This is live; there is
nothing to set up.

| | |
| --- | --- |
| Sheet | `1QZJrNvhEIPk0XVnM6l1YtBPbJNh1hhn8RTpLXnj8HcY` (`Submissions` and discussion tabs) |
| Script project | "Evolving AI - submissions endpoint" (standalone, in the same Drive) |
| Endpoint | set as `apiUrl` in `docs/index.html`; keep `docs/config.js` aligned for older clients |
| Deployment | Execute as: Erik · Who has access: **Anyone** (anonymous submissions) |
| Admin key | in the script as `ADMIN_KEY`; deliberately **not** in this repo |
| Passcode salt | in the script as `SALT`; never leaves it. Changing it invalidates every passcode |

The organizer console's **From the sheet** tab asks for that admin key and pulls the whole
roster. The key is held only while the page is open.

**Why it is built this way:** Apps Script sends no CORS headers. The current website and
iOS build send reads and writes through a `no-cors` POST relay. Responses are retrieved
with short-lived random tickets; personal access answers and organizer keys stay out of
GET URLs for current clients. Apps Script deployment version 16 serves the relay.
Older cached clients can still use legacy JSONP routes and may put their answers or the
organizer key in request URLs. The app reports "Saved to the organizers' sheet" only
after a matching row is read back; an unconfirmed write remains available for retry.

**To rotate the admin key:** open the script project, change `ADMIN_KEY`, then
Deploy → Manage deployments → edit → Version: **New version**. Editing without
re-deploying changes nothing, because the web app serves the deployed version.

**To rotate the invitation passcode:** change the private `GATE_CODE` in the same
script project and deploy a new version to the existing web app. The new code is
needed only for new attendee entries; existing attendees keep access through their
email and favorite-model answer. Give invitees the new code through the normal
invitation channel, and do not put it in this repository.

**To move the endpoint** (new Google account, or a fresh deployment): paste
`docs/sheet-backend.gs` into a new Apps Script project, set its production settings,
deploy as a web app with access **Anyone**, and update `apiUrl` in `docs/index.html`.
Keep `docs/config.js` aligned for older app pages.

**The key is a question, not a password.** Participants name a favorite AI model, which
gates both directions: you cannot read somebody's submission back, and you cannot overwrite
it, without theirs. The answer is normalized in the browser (lowercased, punctuation and
spaces stripped, a trailing "s" dropped) and prefixed `org:`, so "GPT-4", "gpt 4" and
"gpt4" are one key and nobody is locked out by capitals or a hyphen. Only a salted
SHA-256 of `email + key` reaches the sheet, so it cannot be used to recover anyone's answer
and a hash copied between rows is useless. Eight wrong attempts per email triggers a
15-minute cool-off. A damaged or missing stored key requires organizer-assisted recovery
after checking the attendee's identity; the app will not let someone claim that row.

A one-word answer carries less entropy than a password — that is a deliberate trade for a
group of people who would (rightly) find a password prompt insulting. The lockout limits
guessing, but this code does not provide strong account security: a guessed code can expose
an attendee's full submission and discussion access.

Older cached releases can send the personal answer in a JSONP URL. It is HTTPS in transit,
but URLs may be retained in request logs. The shared invitation code should be rotated
because an older public commit contained it.

**Abuse surface:** `apiUrl` is public by nature — anyone reading the page source can POST
a submission. The endpoint only appends or updates rows and never returns the roster
without the key. It can still receive junk rows and consume Apps Script capacity.

## 2. Deploy the site

Any static host works. This repo publishes from `main` / `/docs`. Review and stage
only intended files before committing and pushing; the workspace may contain local
audit outputs or unrelated files.

```bash
git diff --check
git status --short
```

The current public URL is `https://www.benchmark.com/evolving-ai/app/`. After pushing a
website change, verify that URL and its service worker rather than assuming a Git push
has finished propagating.

## 3. Install it on a phone

Open the URL and use **Add to Home Screen** (iOS Safari: Share → Add to Home Screen;
Android Chrome: it offers "Install app"). It then runs full-screen with its own icon and
loads its shell offline after the first visit; Sheet saves and external readings require
a connection. The native iOS app provides the same participant flow.

## 4. The iOS app

`ios/` is a real Xcode project — no CocoaPods, no npm, no third-party dependencies. It
is a WKWebView host that runs the same `docs/` the website runs, so the two cannot drift:
a build phase re-copies `docs/` into the bundle every time, and editing
`ios/EvolvingAI/web` by hand is pointless because it is overwritten.

```bash
open ios/EvolvingAI.xcodeproj
```

Pick a simulator and hit Run. Nothing else to install.

**Why a web view rather than a Swift rewrite.** The app's value is in three places that
are hard to reproduce and easy to get subtly wrong: the subgroup algorithm, the salted
passcode handling, and the JSONP / `no-cors` transport that Apps Script forces. Rewriting
those in Swift would mean maintaining two implementations of the same rules against one
Sheet, and every divergence would show up as a participant whose questions land in the
wrong room. One codebase, one behaviour.

**What the native layer actually does.** The shell is not a bare web view; these are the
things a web view does not get for free, and each one is a thing you would notice if it
were missing:

| | |
| --- | --- |
| `BundleSchemeHandler` | Serves the bundle over `seminar://app`. A `file://` page gets an opaque origin and `localStorage` throws — which is where a half-finished submission lives |
| Outside links | The reading PDFs open in `SFSafariViewController`, so nobody is stranded in a chrome-less page with no way back |
| Launch | A flat brand-coloured launch screen and a matching cover that lifts only once the first screen has painted. No white flash, no blank web view |
| Status bar | An opaque band the height of the top safe area. WebKit does not re-pin a sticky header while the keyboard resizes the viewport, so without it body text runs under the Dynamic Island while you type |
| Scroll | `history.scrollRestoration = "manual"`. WebKit otherwise reopens the app part-way down the page |
| Haptics | A light tap on every control, through a small message handler |
| Chrome | No tap-highlight flash, no long-press callout on controls, no link preview, no double-tap zoom on buttons. Prose stays selectable; pinch zoom still works |
| Keyboard | Dark, matching the palette, and dismissable by swiping down the page |

**Reaching the organizer console.** On the website it is `#organizer`, deliberately
unlinked. An app has no address bar, so it is a **long press on the wordmark**, top
left, for about a second — you will feel a haptic tick. Long press again to leave, or
tap the wordmark. Same bargain: available to anyone who knows, invisible to everyone
who does not.

**Safe areas.** Three rules in `docs/index.html` are keyed on `env(safe-area-inset-*)`.
They are no-ops in any browser where the insets are zero, so the website is unchanged,
and they are what keeps the header off the first field and the last line clear of the
bottom bar on a notched phone — in the app and equally on the site in iOS Safari. A
branch switch reverts `docs/index.html`; `scripts/ios-safe-area.py` puts them back and
is safe to re-run.

**For TestFlight and App Store release:** sign in to Xcode with the Apple Developer account,
select the signing team, and create the signing certificate and provisioning profile. The
store listing, screenshots, privacy policy URL, and review are also required. Be aware
of guideline 4.2 ("minimum functionality"): a form-style app is sometimes rejected, and
the native work above is part of the answer to it, not decoration. If the stores are a
must-have rather than a nice-to-have, the honest sequence is still: ship the installable
web app now, and submit in parallel.

**Android.** Not built. `capacitor.config.json` and the Capacitor dependencies in
`package.json` are left over from the earlier plan and are not what builds the iOS app;
delete them, or keep them if Android is still wanted.

---

## Organizer console

At **https://ewang26.github.io/evolving-ai-app/#organizer** — not linked from the app, so
participants never see it. The Google Sheet holds the raw submissions; this is what turns
them into rooms.

- **Roster** — who has submitted and how many questions each has. Also accepts pasted
  submissions for anyone who sends theirs by email.
- **From the sheet** — enter `ADMIN_KEY` and pull every submission. Safe to re-run; it
  replaces the local roster with whatever the Sheet holds.
- **Demand** — interest per topic, weighted 3/2/1 by rank.
- **Subgroups** — three rounds of parallel breakouts. Everyone sits all three of their
  ranked topics, one per round; which topic falls in which round is chosen to open the
  fewest parallel groups, so oversubscribed topics simply run more rooms at once. At
  55–60 participants this lands on 11–12 groups per round of 4–6 people. A group that
  cannot be filled is flagged *merge or reassign* rather than silently left tiny.
  Note: groups are no longer balanced across the two communities, because the app no
  longer asks which field people come from. Affiliation is the only signal left.
- **Question sheets** — print-ready, one block per group: topic, required reading, the
  members, and every question they submitted. This is what circulates the night before.

## Data

Submissions contain a name, email, affiliation, a salted personal-answer hash, topic choices,
questions, and optional work details. They are stored in the organizer's Google Sheet and
the participant's local draft. Current copied links contain only the public app address;
older `#s=` links may still contain a readable submission. There is no analytics SDK.
The public `apiUrl` can receive unwanted requests, so organizers should monitor the Sheet.
The organizer key is held in memory while the console is open.

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

---

## Discussion, debriefs and reminders

**Topic discussion.** The live reading page opens a thread for each of the attendee's
three chosen topics. Posts live in a **Posts** tab. The backend checks that the attendee
chose a topic before allowing its thread to be read or posted to.

**General discussion.** The same thread machinery under the key `general`, reached from the
reading page.

**Who can take part.** Reading *and* posting require the same email + favorite-AI-model key
that guards a submission, checked server-side against the Submissions row. Posts are
attributable, and only people with a saved attendee entry can join.

**Group debrief.** The backend retains a debrief route and a **Debriefs** tab, but the
current participant reading flow does not expose a debrief form.

**Nudges.** Two parts:
- In-app: an attendee marks each reading complete with its Read control; the reading
  page shows progress. This records their choice, not whether they read the paper.
- Email: `sendReminders()` in `docs/sheet-backend.gs` mails anyone with no submission, or a
  submission missing questions, using an **Invitees** tab (Name, Email) to know who is
  expected. It is **not armed**: `DRY_RUN = true` and no trigger is installed, so it sends
  nothing until someone sets `DRY_RUN = false` and adds a Day-timer trigger on
  `sendReminders`. Run it once with `DRY_RUN` on and read the execution log first.

**Latency, honestly.** Apps Script takes 1–3s per call and cannot push, so posts appear on
open or Refresh, not live. Fine for this scale; it will not feel like Slack. Swapping the
store later means replacing `cloudPosts` / `cloudWrite` only.
