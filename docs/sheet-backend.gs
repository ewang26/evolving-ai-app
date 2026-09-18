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
 *  3. Change ADMIN_KEY below to a long random string. Keep it private —
 *     it is only ever typed into the organizer console, never shipped in the app.
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

var HEADERS = ["Timestamp", "Name", "Email", "Affiliation", "Community",
               "1st", "2nd", "3rd", "Q1", "Q2", "Q3", "Payload"];

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
    return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(row[HEADERS.length - 1])).getDataAsString());
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
    if (!sub.n || !sub.e || !sub.r || !sub.r.length) return out_({ok: false, error: "incomplete"});

    var sh = sheet_();
    var qs = sub.r.map(function (id) { return String((sub.q || {})[id] || ""); });
    var payload = Utilities.base64EncodeWebSafe(JSON.stringify(sub)).replace(/=+$/, "");
    var row = [
      new Date(), sub.n, String(sub.e).trim(), sub.a || "", sub.c || "",
      sub.r[0] || "", sub.r[1] || "", sub.r[2] || "",
      qs[0] || "", qs[1] || "", qs[2] || "",
      payload
    ];

    var at = findRow_(sh, sub.e);
    if (at > 0) sh.getRange(at, 1, 1, HEADERS.length).setValues([row]);
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
      var at = findRow_(sh, p.email);
      if (at < 0) return out_({ok: true, row: null}, cb);
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
