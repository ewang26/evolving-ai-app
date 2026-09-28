const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '../../docs/sheet-backend.gs'), 'utf8');

function backend() {
  const tabs = {}, cache = new Map();
  let releaseCount = 0;
  const newSheet = name => tabs[name] = {
    rows: [],
    getLastRow() { return this.rows.length; },
    appendRow(row) { this.rows.push(row.slice()); },
    deleteRows(start, count) { this.rows.splice(start - 1, count); },
    setFrozenRows() {},
    getRange(r, c, n = 1, m = 1) {
      const sh = this;
      return {
        getValues: () => Array.from({ length: n }, (_, i) =>
          Array.from({ length: m }, (_, j) => sh.rows[r - 1 + i]?.[c - 1 + j] ?? '')),
        getValue: () => sh.rows[r - 1]?.[c - 1] ?? '',
        setValues(values) { values.forEach((row, i) => row.forEach((value, j) => {
          sh.rows[r - 1 + i] ??= [];
          sh.rows[r - 1 + i][c - 1 + j] = value;
        })); },
        setValue(value) { sh.rows[r - 1] ??= []; sh.rows[r - 1][c - 1] = value; },
        setFontWeight() {}
      };
    }
  };
  const lock = { waitLock() {}, releaseLock() { releaseCount++; } };
  const c = {
    console: { error() {} }, Date, JSON,
    Logger: { log() {} },
    LockService: { getScriptLock: () => lock },
    SpreadsheetApp: { openById: () => ({ getSheetByName: n => tabs[n], insertSheet: newSheet }) },
    CacheService: { getScriptCache: () => ({
      get: key => cache.get(key) ?? null, put: (key, value) => cache.set(key, value),
      remove: key => cache.delete(key)
    }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (algorithm, text) => crypto.createHash(algorithm).update(text).digest(),
      base64Encode: bytes => Buffer.from(bytes).toString('base64'),
      base64EncodeWebSafe: text => Buffer.from(text).toString('base64url'),
      base64DecodeWebSafe: text => Buffer.from(text, 'base64url'),
      newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes).toString() }),
      getUuid: () => crypto.randomUUID()
    },
    ContentService: { MimeType: { JSON: 'json', JAVASCRIPT: 'js' },
      createTextOutput: body => ({ body, getContent() { return body; }, setMimeType() { return this; } }) },
  };
  vm.runInNewContext(source, c);
  c.SALT = 'synthetic-salt'; c.ADMIN_KEY = 'synthetic-admin'; c.GATE_CODE = 'synthetic-gate';
  return {
    c, tabs, lock,
    releases: () => releaseCount,
    post: body => JSON.parse(c.doPost({ postData: { contents: JSON.stringify(body) } }).body),
    get: params => JSON.parse(c.doGet({ parameter: params }).body)
  };
}

module.exports = { backend };
