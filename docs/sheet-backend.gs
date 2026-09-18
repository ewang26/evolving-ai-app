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
               "New topic"];

var PASS_COL    = 11;   // 1-based column of the Passcode hash
var MAX_TRIES   = 8;    // failed passcode attempts per email before a cool-off
var LOCK_SECS   = 900;

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
  }
  return sh;
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
    var sub  = body.sub || {};
    var code = String(body.pin || "");
    if (!sub.n || !sub.e || !sub.r || !sub.r.length) return out_({ok: false, error: "incomplete"});
    if (code.trim().length < 4) return out_({ok: false, error: "bad_pin"});
    if (locked_(sub.e)) return out_({ok: false, error: "locked"});

    var sh = sheet_();
    var existing = findRow_(sh, sub.e);
    var mine = hash_(sub.e, code);

    // An existing entry may only be overwritten by whoever set its passcode.
    if (existing > 0) {
      var onFile = sh.getRange(existing, PASS_COL).getValue();
      if (onFile && !same_(onFile, mine)) {
        noteFail_(sub.e);
        return out_({ok: false, error: "bad_pin"});
      }
    }
    clearFails_(sub.e);
    var qs = sub.r.map(function (id) { return String((sub.q || {})[id] || ""); });
    var payload = Utilities.base64EncodeWebSafe(JSON.stringify(sub)).replace(/=+$/, "");
    var row = [
      new Date(), sub.n, String(sub.e).trim(), sub.a || "",
      sub.r[0] || "", sub.r[1] || "", sub.r[2] || "",
      qs[0] || "", qs[1] || "", qs[2] || "",
      mine,
      payload,
      sub.t || ""
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
      // No passcode on file (a pre-passcode row): nobody may read it back.
      if (!onFile || !same_(onFile, hash_(p.email, code))) {
        noteFail_(p.email);
        return out_({ok: false, error: "bad_pin"}, cb);
      }
      clearFails_(p.email);

      var vals = sh.getRange(at, 1, 1, HEADERS.length).getValues()[0];
      return out_({ok: true, row: rowToSub_(vals)}, cb);
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
