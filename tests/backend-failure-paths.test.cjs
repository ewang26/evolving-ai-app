const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '../docs/sheet-backend.gs'), 'utf8');

function backend() {
  const tabs = {}, cache = new Map();
  let releaseCount = 0;
  const newSheet = name => tabs[name] = {
    rows: [],
    getLastRow() { return this.rows.length; },
    appendRow(row) { this.rows.push(row.slice()); },
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
    LockService: { getScriptLock: () => lock },
    SpreadsheetApp: { openById: () => ({ getSheetByName: n => tabs[n], insertSheet: newSheet }) },
    CacheService: { getScriptCache: () => ({
      get: key => cache.get(key), put: (key, value) => cache.set(key, value),
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
      createTextOutput: body => ({ body, setMimeType() { return this; } }) }
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

const submission = () => ({ n: 'Synthetic Attendee', e: 'synthetic@example.invalid', a: 'Test',
  w: '', c: '', hopes: '', moreWork: '', r: ['', '', ''], q: {}, t: '', read: {} });
const create = b => b.post({ action: 'put', sub: submission(), pin: 'test-model', gate: 'synthetic-gate' });

test('partial drafts are accepted, malformed ranks and oversized payloads are rejected', () => {
  const b = backend();
  assert.equal(create(b).ok, true);
  assert.equal(b.post({ sub: { ...submission(), r: ['T1', 'T1', 'T2'] }, pin: 'test-model' }).error,
    'invalid_submission');
  assert.equal(b.post({ sub: { ...submission(), r: ['T1', 'T2', 'UNKNOWN'] }, pin: 'test-model' }).error,
    'invalid_submission');
  assert.equal(b.post({ sub: { ...submission(), e: '=x@example.invalid' }, pin: 'test-model' }).error,
    'invalid_submission');
  assert.equal(b.post({ sub: { ...submission(), e: '+test@example.invalid' },
    pin: 'test-model', gate: 'synthetic-gate' }).ok, true);
  assert.equal(b.post({ sub: { ...submission(), read: { huge: 'x'.repeat(50000) } }, pin: 'test-model' }).error,
    'too_large');
  assert.equal(b.tabs.Submissions.rows.length, 3);
});

test('lock timeout returns a bounded error and does not release an unheld lock', () => {
  const b = backend();
  b.lock.waitLock = () => { throw Error('synthetic lock timeout'); };
  assert.equal(b.post({ sub: submission(), pin: 'test-model', gate: 'synthetic-gate' }).error,
    'backend_error');
  assert.equal(b.releases(), 0);
});

test('an empty or damaged stored key cannot be used to claim an existing account', () => {
  const b = backend(); create(b);
  const row = b.tabs.Submissions.rows[1];
  for (const damaged of ['', '#ERROR!']) {
    row[10] = damaged;
    assert.equal(b.post({ sub: { ...submission(), n: 'Other claimant' }, pin: 'other-model' }).error,
      'key_reset');
    assert.equal(row[1], 'Synthetic Attendee');
    assert.equal(b.get({ action: 'get', email: submission().e, pin: 'other-model' }).error,
      'key_reset');
  }
});

test('attendee formulas stay literal in every Sheet tab and discussion reads stay legible', () => {
  const b = backend(), sub = { ...submission(), n: '=1+1', a: '=2+2',
    r: ['T1', 'T2', 'T3'], q: { T1: '=3+3' } };
  assert.equal(b.post({ sub, pin: 'test-model', gate: 'synthetic-gate' }).ok, true);
  assert.equal(b.tabs.Submissions.rows[1][1], "'=1+1");
  assert.equal(b.tabs.Submissions.rows[1][7], "'=3+3");
  assert.equal(b.post({ action: 'post', email: sub.e, pin: 'test-model',
    thread: 'topic:T1', body: '=4+4' }).ok, true);
  assert.equal(b.tabs.Posts.rows[1][6], "'=4+4");
  const topic = b.get({ action: 'topic', topic: 'T1', email: sub.e, pin: 'test-model' });
  assert.equal(topic.questions[0].q, '=3+3');
  assert.equal(topic.posts[0].body, '=4+4');
  assert.equal(b.post({ action: 'debrief', email: sub.e, pin: 'test-model',
    debrief: { claim: '=5+5' } }).ok, true);
  assert.equal(b.tabs.Debriefs.rows[1][6], "'=5+5");
});

test('malformed post dates do not take down a whole discussion', () => {
  const b = backend(); create(b);
  b.post({ action: 'post', email: submission().e, pin: 'test-model',
    thread: 'general', body: 'Synthetic discussion' });
  b.tabs.Posts.rows[1][1] = 'bad date';
  const result = b.get({ action: 'posts', thread: 'general',
    email: submission().e, pin: 'test-model' });
  assert.equal(result.ok, true);
  assert.equal(result.posts[0].at, '');
  assert.equal(result.posts[0].body, 'Synthetic discussion');
});

test('post limit and thread validation reject writes rather than silently truncating', () => {
  const b = backend(); create(b);
  const credentials = { action: 'post', email: submission().e, pin: 'test-model' };
  assert.equal(b.post({ ...credentials, thread: 'general', body: 'x'.repeat(4001) }).error,
    'too_long');
  assert.equal(b.post({ ...credentials, thread: '=malicious', body: 'hello' }).error,
    'invalid_thread');
  assert.equal(b.tabs.Posts, undefined);
});

test('retrying a post with the same client ID does not duplicate it', () => {
  const b = backend(); create(b);
  const post = { action: 'post', id: 'synthetic-post-id-0001', email: submission().e,
    pin: 'test-model', thread: 'general', body: 'One synthetic comment' };
  assert.equal(b.post(post).ok, true);
  assert.equal(b.post(post).ok, true);
  assert.equal(b.tabs.Posts.rows.length, 2);
  assert.equal(b.post({ ...post, body: 'Changed comment' }).error, 'post_id_conflict');
  assert.equal(b.tabs.Posts.rows.length, 2);
  assert.equal(b.get({ action: 'posts', thread: 'general', email: post.email, pin: post.pin })
    .posts[0].id, post.id);
});

test('a save carrying an older row revision cannot overwrite newer answers', () => {
  const b = backend(); create(b);
  const get = () => b.get({ action: 'get', email: submission().e, pin: 'test-model' });
  const old = get().rev;
  const newer = { ...submission(), q: { T1: 'Answer from another device' } };
  assert.equal(b.post({ action: 'put', sub: newer, pin: 'test-model', ifMatch: old }).ok, true);
  assert.notEqual(get().rev, old);
  const stale = { ...submission(), q: { T1: 'Stale answer' } };
  assert.equal(b.post({ action: 'put', sub: stale, pin: 'test-model', ifMatch: old }).error,
    'conflict');
  assert.equal(get().row.q.T1, 'Answer from another device');
});

test('a first-save absence check cannot overwrite a row created by another device', () => {
  const b = backend();
  const first = { action: 'put', sub: submission(), pin: 'test-model',
    gate: 'synthetic-gate', ifMatch: 'absent' };
  assert.equal(b.post(first).ok, true);
  assert.equal(b.post({ ...first, sub: { ...submission(), n: 'Second device' } }).error,
    'conflict');
  assert.equal(b.tabs.Submissions.rows[1][1], 'Synthetic Attendee');
});

test('discussion login reports lockout separately from a wrong model code', () => {
  const b = backend(); create(b);
  for (let i = 0; i < b.c.MAX_TRIES; i++) b.c.noteFail_(submission().e);
  assert.equal(b.get({ action: 'posts', thread: 'general',
    email: submission().e, pin: 'test-model' }).error, 'locked');
  assert.equal(b.post({ action: 'post', thread: 'general', body: 'hello',
    email: submission().e, pin: 'test-model' }).error, 'locked');
});

test('damaged payload is reported as damaged, and gate check works without Sheet access', () => {
  const b = backend(); create(b);
  b.tabs.Submissions.rows[1][11] = 'not-base64-json';
  assert.equal(b.get({ action: 'get', email: submission().e, pin: 'test-model' }).error,
    'corrupt_payload');
  b.c.SpreadsheetApp.openById = () => { throw Error('Sheet unavailable'); };
  assert.equal(b.get({ action: 'gate', code: 'synthetic-gate' }).valid, true);
});

test('invalid JSONP callback cannot be injected into executable output', () => {
  const b = backend();
  const result = b.c.doGet({ parameter: { action: 'gate', code: 'synthetic-gate',
    callback: 'alert(1)//' } });
  assert.equal(JSON.parse(result.body).error, 'invalid_callback');
});
