/**
 * Evolving AI — seminar prep backend.
 *
 * Paste this into a Google Sheet's Apps Script editor and deploy it as a Web
 * App. It stores one row per participant, keyed on email, and serves rows
 * back over JSONP so the app can restore somebody's reading on a new device.
 *
 * SETUP
 *  1. Create a Google Sheet. Name the first tab  Submissions
 *  2. Extensions > Apps Script. Delete the stub, paste this file in.
 *  3. Change ADMIN_KEY and SALT below to long random strings. ADMIN_KEY is
 *     typed into the organizer console; SALT is never shown to anyone. Neither
 *     is shipped in the app. Changing SALT invalidates every stored passcode.
 *  4. Deploy > New deployment > type: Web app.
 *       Execute as:        Me
 *       Who has access:    Anyone
 *     ("Anyone" is what lets a participant's browser post without a Google
 *      login. The endpoint only ever appends submissions; the roster listing
 *      is gated on ADMIN_KEY.)
 *  5. Copy the /exec URL it gives you into app/config.js as apiUrl, then
 *     redeploy the site.
 *
 * Re-deploy after any edit (Deploy > Manage deployments > edit > Version: New).
 */

var SHEET_ID    = "1QZJrNvhEIPk0XVnM6l1YtBPbJNh1hhn8RTpLXnj8HcY";
var SHEET_NAME  = "Submissions";
var ADMIN_KEY   = "CHANGE-ME-to-a-long-random-string";
var SALT        = "CHANGE-ME-to-a-second-long-random-string";

var HEADERS = ["Timestamp", "Name", "Email", "Affiliation",
               "1st", "2nd", "3rd", "Q1", "Q2", "Q3", "Passcode", "Payload",
               "New topic", "Work", "Link", "Gathering goals and contribution", "More work details (optional)"];

var PASS_COL    = 11;   // 1-based column of the Passcode hash

var POSTS_SHEET    = "Posts";
var POST_HEADERS   = ["Id", "Timestamp", "Thread", "Name", "Email", "Affiliation", "Body"];
var DEBRIEF_SHEET  = "Debriefs";
var DEBRIEF_HEADERS= ["Timestamp", "Round", "Group", "Topic", "Name", "Email",
                      "Claim", "Disagreement", "What would settle it"];
var INVITEES_SHEET = "Invitees";
var INVITEE_HEADERS= ["Name", "Email", "Reminders sent", "Last reminder"];
/* The shared code from the invitation email. A new submission must carry it;
   reads are already gated on having a submission, so this is what keeps the
   discussion private once the app is linked publicly. Set the real value HERE
   and nowhere else — the front-end repo is public. Empty string = no gate. */
var GATE_CODE      = "CHANGE-ME-to-the-shared-attendee-passcode";

var MAX_BODY       = 4000;
var MAX_TRIES   = 8;    // failed passcode attempts per email before a cool-off
var LOCK_SECS   = 900;

// Existing test questions hidden from discussions on 2026-09-22.
// Exact email/topic/question fingerprints keep submissions intact and allow
// these attendees to contribute new questions. Removing a key restores it.
var HIDDEN_DISCUSSION_QUESTIONS = [
  "2c3eea96e8e9a77ec4df474130b26429eba77db40a80dad0c7d13f42d0ec6f36",
  "09d86d798fe0370a74dd4cfed11b2ca2378ae4aee02e7e1befef8bdb09f9ddfe",
  "8809cdcc1db3137d638a4d16aa18edb91fb04eb1aca58192b43955eb89794110",
  "3cdd6088c2fcd74fb5317c53e9b864a26fafda37ca1b07876400433315cff06f",
  "f3351d12b3df0bed77a916982050e07f70ea37acaf91c53604d628709b3dfbb9",
  "cfbd9839e80f285f594cb0da41efd9c48975061c576e54fde68feb7ed9654763",
  "429034323f6c0f1ab32ae50e42986818b16bd7f9f06d10f9430db8c5069aa909",
  "efc00a2366bcf4dedacf7ac142e4c01e3c67aae0d49f035d274ea588f4b1e4ac",
  "3370519d75c9d482aec7b733e752a196b938e57b2e1155a0da99696654cf9ec8",
  "9199388a42ba53de2da862c4489a52cc2956565bef6be24cdac7ab4ea388358e",
  "a906433f258c8b6f65ddf91dd9e1deac1f45ac9fb04ea03f0af4a1ea52ef85d4",
  "16a6b687a03602800ecbf79da3e7d8f8cf808250b6473433a327451029584aa3",
  "7d14d99582c790bf881cc15ea2c96cdb0ed66cdff2b85c3595a8e59417253304",
  "0ca211265131833c468be89aff33c9ba229379e40ab7849344c6705cbfebecfc",
  "5a3092f3356e2035593d8c5676f485e4a330184822f77ae0edad82612e493ac2",
  "7e07f67818d3f25cdfb248b145a6eb3ac0d819c47bdfb73eef98b324b9dc6be4",
  "8f246f22f04bacd158a78627b0680f6da62f8f7d819e0e8dcb392727196a146c",
  "f7f2b05aedadbfe8aa7514a14c4f15ae9cd10b38132f8b9ca7a889eb214cd55a"
];
function discussionQuestionVisible_(email, topic, question) {
  var text = String(question || "").trim();
  if (!text) return false;
  var raw = JSON.stringify([String(email || "").trim().toLowerCase(), String(topic || ""), text]);
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  var key = Array.prototype.map.call(digest, function(b) {
    return ("0" + ((b + 256) % 256).toString(16)).slice(-2);
  }).join("");
  return HIDDEN_DISCUSSION_QUESTIONS.indexOf(key) < 0;
}

/**
 * Passcodes are never stored. What lands in the sheet is a salted SHA-256 of
 * the passcode bound to the email, so the sheet cannot be used to recover
 * anybody's passcode, and a hash lifted from one row is useless on another.
 * SALT lives only in this script — it is deliberately not in the public repo.
 */
function hash_(email, code) {
  var raw = SALT + "|" + String(email || "").trim().toLowerCase() + "|" + String(code || "");
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8));
}

/**
 * A base64 hash can begin with "+" or "/", which Sheets parses as a FORMULA and
 * stores as #ERROR! — silently locking that person out for good. Writing it
 * behind a "k:" prefix makes the cell unambiguously text. Bare hashes from
 * before this fix still verify.
 */
var KEY_PREFIX = "k:";
function stored_(h) { return KEY_PREFIX + h; }
function corrupt_(v) { return String(v || "").charAt(0) === "#"; }
function keyMatches_(onFile, h) {
  onFile = String(onFile || "");
  return same_(onFile, stored_(h)) || same_(onFile, h);
}

/** Constant-time-ish compare, so a wrong passcode leaks nothing by timing. */
function same_(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function tries_(email) { return "pin:" + String(email || "").trim().toLowerCase(); }

function locked_(email) {
  var c = CacheService.getScriptCache().get(tries_(email));
  return c && Number(c) >= MAX_TRIES;
}
function noteFail_(email) {
  var cache = CacheService.getScriptCache(), k = tries_(email);
  var n = Number(cache.get(k) || 0) + 1;
  cache.put(k, String(n), LOCK_SECS);
}
function clearFails_(email) { CacheService.getScriptCache().remove(tries_(email)); }

function sheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
    sh.setFrozenRows(1);
  } else {
    // Extend older sheets without moving their existing columns or responses.
    var extra = sh.getRange(1, 14, 1, HEADERS.length - 13).getValues()[0];
    extra.forEach(function(value, i) {
      if (value && value !== HEADERS[i + 13]) throw new Error("Unexpected submission column " + (i + 14));
    });
    if (extra.some(function(value) { return !value; })) {
      sh.getRange(1, 14, 1, HEADERS.length - 13).setValues([HEADERS.slice(13)]);
      sh.getRange(1, 14, 1, HEADERS.length - 13).setFontWeight("bold");
    }
  }
  return sh;
}

/** A tab, created with its header row the first time it is needed. */
function tab_(name, headers) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  return sh;
}

/**
 * Discussion is for people who have submitted. The same email + favorite-model
 * key that guards a submission also gates reading and posting, so posts are
 * attributable and outsiders who find this URL see nothing.
 */
function verify_(email, code) {
  if (String(code || "").trim().length < 4) return null;
  if (locked_(email)) return null;
  var sh = sheet_();
  var at = findRow_(sh, email);
  if (at < 0) return null;
  var onFile = sh.getRange(at, PASS_COL).getValue();
  if (!onFile || corrupt_(onFile)) return "reset";      // needs re-submitting, not a wrong key
  if (!keyMatches_(onFile, hash_(email, code))) { noteFail_(email); return null; }
  clearFails_(email);
  var row = sh.getRange(at, 1, 1, HEADERS.length).getValues()[0];
  return {name: row[1], email: row[2], affiliation: row[3]};
}

/** Forgiving on purpose: "Harvard26", "harvard 26" and "HARVARD-26" all pass,
    so nobody is turned away by capitals, a space or a hyphen. */
function gateNorm_(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function gateOpen_(v) {
  if (!GATE_CODE) return true;                       // no gate configured
  return gateNorm_(v) === gateNorm_(GATE_CODE);
}

function rowsOf_(sh, headers) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, headers.length).getValues();
}

function out_(obj, callback) {
  var body = JSON.stringify(obj);
  if (callback) {
    return ContentService
      .createTextOutput(callback + "(" + body + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(body)
    .setMimeType(ContentService.MimeType.JSON);
}

function rowToSub_(row) {
  // The Payload column holds the app's own encoding, so a restore is exact.
  try {
    return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(row[HEADERS.indexOf("Payload")])).getDataAsString());
  } catch (e) {
    return null;
  }
}

function findRow_(sh, email) {
  var key = String(email || "").trim().toLowerCase();
  if (!key) return -1;
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var emails = sh.getRange(2, 3, last - 1, 1).getValues();
  for (var i = 0; i < emails.length; i++) {
    if (String(emails[i][0]).trim().toLowerCase() === key) return i + 2;
  }
  return -1;
}

/** Participant submits (or re-submits) — called with a simple no-cors POST. */
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var body = JSON.parse(e.postData.contents);

    // A discussion post.
    if (body.action === "post") {
      var poster = verify_(body.email, body.pin);
      if (poster === "reset") return out_({ok: false, error: "key_reset"});
      if (!poster) return out_({ok: false, error: "bad_pin"});
      var text = String(body.body || "").trim();
      if (!text) return out_({ok: false, error: "empty"});
      if (text.length > MAX_BODY) text = text.slice(0, MAX_BODY);
      tab_(POSTS_SHEET, POST_HEADERS).appendRow([
        Utilities.getUuid().slice(0, 8), new Date(), String(body.thread || "general"),
        poster.name, poster.email, poster.affiliation, text
      ]);
      return out_({ok: true});
    }

    // An end-of-day group debrief.
    if (body.action === "debrief") {
      var rap = verify_(body.email, body.pin);
      if (rap === "reset") return out_({ok: false, error: "key_reset"});
      if (!rap) return out_({ok: false, error: "bad_pin"});
      var d = body.debrief || {};
      if (!String(d.claim || "").trim()) return out_({ok: false, error: "empty"});
      tab_(DEBRIEF_SHEET, DEBRIEF_HEADERS).appendRow([
        new Date(), d.round || "", d.group || "", d.topic || "",
        rap.name, rap.email,
        String(d.claim || "").slice(0, MAX_BODY),
        String(d.disagreement || "").slice(0, MAX_BODY),
        String(d.settle || "").slice(0, MAX_BODY)
      ]);
      return out_({ok: true});
    }

    var sub  = body.sub || {};
    var code = String(body.pin || "");
    if (!sub.n || !sub.e || !sub.r || !sub.r.length) return out_({ok: false, error: "incomplete"});
    if (code.trim().length < 4) return out_({ok: false, error: "bad_pin"});
    if (locked_(sub.e)) return out_({ok: false, error: "locked"});

    var sh = sheet_();
    var existing = findRow_(sh, sub.e);
    var mine = hash_(sub.e, code);

    // A NEW submission must carry the shared code. An existing row is left
    // alone: it is already guarded by the key that created it, which is why
    // nobody has to type the code a second time.
    if (existing < 0 && !gateOpen_(body.gate)) {
      return out_({ok: false, error: "bad_gate"});
    }

    // An existing entry may only be overwritten by whoever set its passcode.
    if (existing > 0) {
      var onFile = sh.getRange(existing, PASS_COL).getValue();
      if (onFile && !corrupt_(onFile) && !keyMatches_(onFile, mine)) {
        noteFail_(sub.e);
        return out_({ok: false, error: "bad_pin"});
      }
      // A still-open older form must not erase fields it does not know about.
      var previous = rowToSub_(sh.getRange(existing, 1, 1, HEADERS.length).getValues()[0]);
      ["hopes", "moreWork"].forEach(function(key) {
        if (!Object.prototype.hasOwnProperty.call(sub, key) && previous) sub[key] = previous[key] || "";
      });
    }
    clearFails_(sub.e);
    var qs = sub.r.map(function (id) { return String((sub.q || {})[id] || ""); });
    var payload = Utilities.base64EncodeWebSafe(JSON.stringify(sub), Utilities.Charset.UTF_8).replace(/=+$/, "");
    var row = [
      new Date(), sub.n, String(sub.e).trim(), sub.a || "",
      sub.r[0] || "", sub.r[1] || "", sub.r[2] || "",
      qs[0] || "", qs[1] || "", qs[2] || "",
      stored_(mine),
      payload,
      sub.t || "",
      sub.w || "",
      sub.c || "",
      sub.hopes || "",
      sub.moreWork || ""
    ];

    if (existing > 0) sh.getRange(existing, 1, 1, HEADERS.length).setValues([row]);
    else sh.appendRow(row);

    return out_({ok: true});
  } catch (err) {
    return out_({ok: false, error: String(err)});
  } finally {
    lock.releaseLock();
  }
}

/** JSONP reads: one participant by email, or the whole roster with the key. */
function doGet(e) {
  var p  = e.parameter || {};
  var cb = p.callback;
  try {
    var sh = sheet_();

    if (p.action === "get") {
      var code = String(p.pin || "");
      if (locked_(p.email)) return out_({ok: false, error: "locked"}, cb);
      if (code.trim().length < 4) return out_({ok: false, error: "bad_pin"}, cb);

      var at = findRow_(sh, p.email);
      if (at < 0) return out_({ok: true, row: null}, cb);

      var onFile = sh.getRange(at, PASS_COL).getValue();
      // No key on file (a pre-key row): nobody may read it back.
      if (!onFile) return out_({ok: false, error: "bad_pin"}, cb);
      // A key Sheets ate as a formula: repairable by re-submitting, not a wrong key.
      if (corrupt_(onFile)) return out_({ok: false, error: "key_reset"}, cb);
      if (!keyMatches_(onFile, hash_(p.email, code))) {
        noteFail_(p.email);
        return out_({ok: false, error: "bad_pin"}, cb);
      }
      clearFails_(p.email);

      var vals = sh.getRange(at, 1, 1, HEADERS.length).getValues()[0];
      return out_({ok: true, row: rowToSub_(vals)}, cb);
    }

    // Posts in one thread, oldest first. A thread key is "general" or
    // "<topicId>#<reading index>", e.g. "T3#0".
    // Checked before the form is filled in, so a wrong code is caught on the
    // first screen. doPost enforces it regardless, so this is only courtesy —
    // and after enough wrong guesses it stops answering, to blunt a script.
    if (p.action === "gate") {
      if (!GATE_CODE) return out_({ok: true, valid: true}, cb);
      if (gateOpen_(p.code)) { clearFails_("#gate"); return out_({ok: true, valid: true}, cb); }
      if (locked_("#gate")) return out_({ok: true, valid: true}, cb);   // fail open: doPost still refuses
      noteFail_("#gate");
      return out_({ok: true, valid: false}, cb);
    }

    if (p.action === "posts") {
      var who = verify_(p.email, p.pin);
      if (who === "reset") return out_({ok: false, error: "key_reset"}, cb);
      if (!who) return out_({ok: false, error: "bad_pin"}, cb);
      var want = String(p.thread || "general");
      var posts = rowsOf_(tab_(POSTS_SHEET, POST_HEADERS), POST_HEADERS)
        .filter(function (r) { return String(r[2]) === want; })
        .map(function (r) {
          return {id: r[0], at: r[1] ? new Date(r[1]).toISOString() : "",
                  name: r[3], affiliation: r[5], body: r[6],
                  mine: String(r[4]).trim().toLowerCase() === String(who.email).trim().toLowerCase()};
        });
      return out_({ok: true, posts: posts, me: who.name}, cb);
    }

    // A subtopic's discussion: everybody's submitted question for that topic,
    // then the thread. One call so the view opens in a single round trip.
    if (p.action === "topic") {
      var whoT = verify_(p.email, p.pin);
      if (whoT === "reset") return out_({ok: false, error: "key_reset"}, cb);
      if (!whoT) return out_({ok: false, error: "bad_pin"}, cb);
      var tid = String(p.topic || "");
      var qs = [];
      rowsOf_(sheet_(), HEADERS).forEach(function (r) {
        var picks = [r[4], r[5], r[6]], answers = [r[7], r[8], r[9]];
        for (var i = 0; i < 3; i++) {
          if (String(picks[i]) === tid && discussionQuestionVisible_(r[2], picks[i], answers[i])) {
            qs.push({name: r[1], affiliation: r[3], q: answers[i],
                     mine: String(r[2]).trim().toLowerCase() === String(whoT.email).trim().toLowerCase()});
          }
        }
      });
      var tkey = "topic:" + tid;
      var tposts = rowsOf_(tab_(POSTS_SHEET, POST_HEADERS), POST_HEADERS)
        .filter(function (r) { return String(r[2]) === tkey; })
        .map(function (r) {
          return {id: r[0], at: r[1] ? new Date(r[1]).toISOString() : "",
                  name: r[3], affiliation: r[5], body: r[6],
                  mine: String(r[4]).trim().toLowerCase() === String(whoT.email).trim().toLowerCase()};
        });
      return out_({ok: true, questions: qs, posts: tposts}, cb);
    }

    // One call for every badge on the reading page.
    if (p.action === "counts") {
      var who2 = verify_(p.email, p.pin);
      if (who2 === "reset") return out_({ok: false, error: "key_reset"}, cb);
      if (!who2) return out_({ok: false, error: "bad_pin"}, cb);
      var tally = {};
      rowsOf_(tab_(POSTS_SHEET, POST_HEADERS), POST_HEADERS).forEach(function (r) {
        var k = String(r[2]); tally[k] = (tally[k] || 0) + 1;
      });
      var qtally = {};
      rowsOf_(sheet_(), HEADERS).forEach(function (r) {
        var picks = [r[4], r[5], r[6]], answers = [r[7], r[8], r[9]];
        for (var i = 0; i < 3; i++) {
          var tid2 = String(picks[i] || "");
          if (tid2 && discussionQuestionVisible_(r[2], tid2, answers[i])) qtally[tid2] = (qtally[tid2] || 0) + 1;
        }
      });
      return out_({ok: true, counts: tally, questions: qtally}, cb);
    }

    // A rapporteur confirming their own debrief landed.
    if (p.action === "mydebriefs") {
      var who3 = verify_(p.email, p.pin);
      if (who3 === "reset") return out_({ok: false, error: "key_reset"}, cb);
      if (!who3) return out_({ok: false, error: "bad_pin"}, cb);
      var key = String(who3.email).trim().toLowerCase();
      var mine = rowsOf_(tab_(DEBRIEF_SHEET, DEBRIEF_HEADERS), DEBRIEF_HEADERS)
        .filter(function (r) { return String(r[5]).trim().toLowerCase() === key; })
        .map(function (r) { return {round: r[1], group: r[2], claim: r[6]}; });
      return out_({ok: true, debriefs: mine}, cb);
    }

    if (p.action === "debriefs") {
      if (String(p.key || "") !== ADMIN_KEY) return out_({ok: false, error: "bad_key"}, cb);
      var ds = rowsOf_(tab_(DEBRIEF_SHEET, DEBRIEF_HEADERS), DEBRIEF_HEADERS).map(function (r) {
        return {at: r[0] ? new Date(r[0]).toISOString() : "", round: r[1], group: r[2],
                topic: r[3], name: r[4], claim: r[6], disagreement: r[7], settle: r[8]};
      });
      return out_({ok: true, debriefs: ds}, cb);
    }

    if (p.action === "all") {
      if (String(p.key || "") !== ADMIN_KEY) return out_({ok: false, error: "bad_key"}, cb);
      var last = sh.getLastRow();
      if (last < 2) return out_({ok: true, rows: []}, cb);
      var rows = sh.getRange(2, 1, last - 1, HEADERS.length).getValues()
        .map(rowToSub_).filter(function (x) { return !!x; });
      return out_({ok: true, rows: rows}, cb);
    }

    return out_({ok: false, error: "unknown_action"}, cb);
  } catch (err) {
    return out_({ok: false, error: String(err)}, cb);
  }
}

/**
 * Reminder mail. NOT armed: this only runs if you add a time-driven trigger
 * (Triggers > Add trigger > sendReminders > Day timer), and it sends nothing
 * until DRY_RUN is false.
 *
 * Put expected attendees in an "Invitees" tab (Name, Email). Anyone with no
 * submission, or a submission missing a question, gets one note per run; the
 * tab records how many have gone out so nobody is pestered more than twice.
 */
var DRY_RUN     = true;
var MAX_NUDGES  = 2;
var APP_URL     = "https://ewang26.github.io/evolving-ai-app/";

function sendReminders() {
  var sh = sheet_();
  var subs = {};
  rowsOf_(sh, HEADERS).forEach(function (r) {
    var qs = [r[7], r[8], r[9]].filter(function (q) { return String(q || "").trim(); });
    subs[String(r[2]).trim().toLowerCase()] = qs.length;
  });

  var inv = tab_(INVITEES_SHEET, INVITEE_HEADERS);
  var rows = rowsOf_(inv, INVITEE_HEADERS);
  var sent = 0, report = [];

  rows.forEach(function (r, i) {
    var name = String(r[0] || "there").split(" ")[0];
    var email = String(r[1] || "").trim();
    if (!email) return;
    var count = Number(r[2] || 0);
    if (count >= MAX_NUDGES) return;

    var have = subs[email.toLowerCase()];
    var subject, line;
    if (have === undefined) {
      subject = "Evolving AI: your three topics and questions";
      line = "We do not have your topic choices yet.";
    } else if (have < 3) {
      subject = "Evolving AI: " + (3 - have) + " question(s) to go";
      line = "You have chosen your topics and written " + have + " of 3 questions.";
    } else {
      return;
    }

    report.push(email + " -> " + subject);
    if (!DRY_RUN) {
      MailApp.sendEmail(email, subject,
        "Hi " + name + ",\n\n" + line +
        "\n\nThe reading and the form are here: " + APP_URL +
        "\n\nEach breakout runs as a graduate seminar, so your questions are printed" +
        " and shared with your subgroup on Thursday night.\n\n\u2014 Evolving AI");
      inv.getRange(i + 2, 3).setValue(count + 1);
      inv.getRange(i + 2, 4).setValue(new Date());
      sent++;
    }
  });

  Logger.log((DRY_RUN ? "DRY RUN, nothing sent. Would send " + report.length : "Sent " + sent)
    + ":\n" + report.join("\n"));
  return report;
}
