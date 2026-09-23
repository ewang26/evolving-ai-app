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
    pin: 'test-model', gate: 'synthetic-gate' }).error, 'invalid_submission');
  assert.equal(b.post({ sub: { ...submission(), e: '-test@example.invalid' },
    pin: 'test-model', gate: 'synthetic-gate' }).error, 'invalid_submission');
  assert.equal(b.post({ sub: { ...submission(), read: { huge: 'x'.repeat(50000) } }, pin: 'test-model' }).error,
    'too_large');
  assert.equal(b.tabs.Submissions.rows.length, 2);
});

test('November cutoff closes access while retaining all Sheet rows', () => {
  const b = backend();
  b.c.RETENTION_CUTOFF = Date.now() + 60_000;
  assert.equal(create(b).ok, true);
  assert.equal(b.post({ action: 'post', thread: 'general', body: 'Synthetic comment',
    email: submission().e, pin: 'test-model' }).ok, true);
  b.c.RETENTION_CUTOFF = Date.now() - 1;
  assert.equal(b.get({ action: 'get', email: submission().e, pin: 'test-model' }).error,
    'event_closed');
  assert.equal(b.post({ action: 'put', sub: submission(), pin: 'test-model' }).error,
    'event_closed');
  assert.equal(typeof b.c.purgeExpiredAttendeeData, 'undefined');
  assert.equal(b.tabs.Submissions.rows.length, 2);
  assert.equal(b.tabs.Posts.rows.length, 2);
  assert.deepEqual(Array.from(b.tabs.Submissions.rows[0]), Array.from(b.c.HEADERS));
});

test('unset or example setup keys cannot open registration or organizer reads', () => {
  const b = backend();
  for (const gate of ['', '   ', 'CHANGE-ME-to-the-shared-attendee-passcode']) {
    b.c.GATE_CODE = gate;
    assert.equal(b.get({ action: 'gate', code: gate }).valid, false);
    assert.equal(b.post({ action: 'put', sub: submission(), pin: 'test-model', gate }).error,
      'bad_gate');
  }
  for (const key of ['', '   ', 'CHANGE-ME-to-a-long-random-string']) {
    b.c.ADMIN_KEY = key;
    assert.equal(b.get({ action: 'all', key }).error, 'bad_key');
    assert.equal(b.get({ action: 'reports', key }).error, 'bad_key');
  }
  assert.equal(b.tabs.Submissions.rows.length, 1);
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

test('attendees can read and post only in their chosen topic threads', () => {
  const b = backend();
  const first = { ...submission(), r: ['T1', 'T2', 'T3'] };
  const other = { ...submission(), n: 'Other Synthetic Attendee',
    e: 'other@example.invalid', r: ['T4', 'T5', 'T6'], q: { T4: 'Other topic question?' } };
  assert.equal(b.post({ action: 'put', sub: first, pin: 'first-model', gate: 'synthetic-gate' }).ok, true);
  assert.equal(b.post({ action: 'put', sub: other, pin: 'other-model', gate: 'synthetic-gate' }).ok, true);
  assert.equal(b.post({ action: 'post', email: other.e, pin: 'other-model',
    thread: 'topic:T4', body: 'Other topic comment.' }).ok, true);
  const login = { email: first.e, pin: 'first-model' };
  assert.equal(b.get({ action: 'topic', topic: 'T4', ...login }).error, 'topic_forbidden');
  assert.equal(b.get({ action: 'posts', thread: 'topic:T4', ...login }).error, 'topic_forbidden');
  assert.equal(b.get({ action: 'posts', thread: 'T4#1', ...login }).error, 'topic_forbidden');
  assert.equal(b.post({ action: 'post', thread: 'topic:T4', body: 'Unauthorized.', ...login }).error,
    'topic_forbidden');
  assert.equal(b.get({ action: 'counts', ...login }).counts['topic:T4'], undefined);
  assert.equal(b.get({ action: 'counts', ...login }).questions.T4, undefined);
  assert.equal(b.get({ action: 'topic', topic: 'T1', ...login }).ok, true);
  assert.equal(b.post({ action: 'post', thread: 'topic:T1', body: 'Chosen topic.', ...login }).ok, true);
  assert.equal(b.post({ action: 'post', thread: 'general', body: 'General topic.', ...login }).ok, true);
});

test('reserved demo accounts and real attendees cannot see or moderate each other', () => {
  const b = backend();
  const demo = { ...submission(), e: 'eai-app-review-20260922@example.invalid',
    r: ['T1', '', ''], q: { T1: 'Demo question?' } };
  const real = { ...submission(), e: 'attendee@example.org',
    r: ['T1', '', ''], q: { T1: 'Private attendee question?' } };
  assert.equal(b.post({ action: 'put', sub: demo, pin: 'demo-model', gate: 'synthetic-gate' }).ok, true);
  assert.equal(b.post({ action: 'put', sub: real, pin: 'real-model', gate: 'synthetic-gate' }).ok, true);
  const demoPost = b.post({ action: 'post', email: demo.e, pin: 'demo-model',
    thread: 'topic:T1', body: 'Demo comment.' });
  const realPost = b.post({ action: 'post', email: real.e, pin: 'real-model',
    thread: 'topic:T1', body: 'Private attendee comment.' });
  assert.equal(demoPost.ok, true);
  assert.equal(realPost.ok, true);
  for (const [viewer, pin, expected] of [[demo, 'demo-model', 'Demo'],
    [real, 'real-model', 'Private attendee']]) {
    const login = { email: viewer.e, pin };
    const topic = b.get({ action: 'topic', topic: 'T1', ...login });
    assert.equal(topic.questions.length, 1);
    assert.match(topic.questions[0].q, new RegExp('^' + expected));
    assert.equal(topic.posts.length, 1);
    assert.match(topic.posts[0].body, new RegExp('^' + expected));
    assert.equal(b.get({ action: 'posts', thread: 'topic:T1', ...login }).posts.length, 1);
    const counts = b.get({ action: 'counts', ...login });
    assert.equal(counts.questions.T1, 1);
    assert.equal(counts.counts['topic:T1'], 1);
  }
  assert.equal(b.post({ action: 'report', id: realPost.id,
    email: demo.e, pin: 'demo-model' }).error, 'content_missing');
  assert.equal(b.post({ action: 'block', id: demoPost.id,
    email: real.e, pin: 'real-model' }).error, 'content_missing');
});

test('reports are idempotent and blocking an author hides their posts and questions', () => {
  const b = backend();
  const first = { ...submission(), r: ['T1', 'T2', 'T3'], q: { T1: 'A synthetic question?' } };
  const second = { ...submission(), n: 'Second Test', e: 'second@example.invalid',
    r: ['T1', 'T2', 'T3'] };
  assert.equal(b.post({ action: 'put', sub: first, pin: 'first-model', gate: 'synthetic-gate' }).ok, true);
  assert.equal(b.post({ action: 'put', sub: second, pin: 'second-model', gate: 'synthetic-gate' }).ok, true);
  const posted = b.post({ action: 'post', email: first.e, pin: 'first-model',
    thread: 'topic:T1', body: 'A synthetic comment.' });
  const login = { email: second.e, pin: 'second-model' };
  const before = b.get({ action: 'topic', topic: 'T1', ...login });
  assert.equal(before.posts.length, 1);
  assert.equal(before.questions.length, 1);
  assert.equal(b.post({ action: 'report', id: posted.id, ...login }).ok, true);
  assert.equal(b.post({ action: 'report', id: posted.id, ...login }).ok, true);
  assert.equal(b.tabs.Reports.rows.length, 2);
  assert.equal(b.get({ action: 'reports', key: 'wrong' }).error, 'bad_key');
  const reports = b.get({ action: 'reports', key: 'synthetic-admin' });
  assert.equal(reports.reports.length, 1);
  assert.equal(reports.reports[0].body, 'A synthetic comment.');
  assert.equal(b.post({ action: 'hide', id: posted.id, key: 'wrong' }).error, 'bad_key');
  assert.equal(b.post({ action: 'hide', id: posted.id, key: 'synthetic-admin' }).ok, true);
  assert.equal(b.get({ action: 'reports', key: 'synthetic-admin' }).reports[0].hidden, true);
  assert.equal(b.get({ action: 'topic', topic: 'T1', email: first.e, pin: 'first-model' }).posts.length, 0);
  assert.equal(b.post({ action: 'hide', id: before.questions[0].id, key: 'synthetic-admin' }).ok, true);
  assert.equal(b.post({ action: 'hide', id: before.questions[0].id, key: 'synthetic-admin' }).ok, true);
  assert.equal(b.get({ action: 'topic', topic: 'T1', email: first.e, pin: 'first-model' }).questions.length, 0);
  assert.equal(b.post({ action: 'block', id: before.questions[0].id, ...login }).ok, true);
  assert.equal(b.post({ action: 'block', id: posted.id, ...login }).ok, true);
  assert.equal(b.tabs.Blocks.rows.length, 2);
  const after = b.get({ action: 'topic', topic: 'T1', ...login });
  assert.equal(after.posts.length, 0);
  assert.equal(after.questions.length, 0);
  assert.equal(b.get({ action: 'counts', ...login }).counts['topic:T1'] || 0, 0);
  assert.equal(b.tabs['Hidden content'].rows.length, 3);
});

test('server filters objectionable posts and questions from discussion reads', () => {
  const b = backend();
  const sub = { ...submission(), r: ['T1', 'T2', 'T3'], q: { T1: 'pornography' } };
  assert.equal(b.post({ action: 'put', sub, pin: 'test-model', gate: 'synthetic-gate' }).ok, true);
  assert.equal(b.get({ action: 'topic', topic: 'T1', email: sub.e, pin: 'test-model' }).questions.length, 0);
  assert.equal(b.post({ action: 'post', email: sub.e, pin: 'test-model',
    thread: 'general', body: 'pornography' }).error, 'content_filtered');
  assert.equal(b.tabs.Posts.rows.length, 1);
});

test('private relay returns a read through a random ticket without credentials in the GET', () => {
  const b = backend();
  const sub = { ...submission(), n: '</script><img src=x>', r: ['T1', 'T2', 'T3'] };
  assert.equal(b.post({ action: 'put', sub, pin: 'synthetic-model', gate: 'synthetic-gate' }).ok, true);
  const requestId = '0123456789abcdef0123456789abcdef';
  assert.equal(b.get({ action: 'poll', requestId, part: 0 }).error, 'pending');
  assert.equal(b.post({ action: 'relay', requestId,
    request: { action: 'get', email: sub.e, pin: 'synthetic-model' } }).ok, true);
  const chunk = b.get({ action: 'poll', requestId, part: 0 });
  assert.equal(chunk.ok, true);
  assert.equal(chunk.parts, 1);
  assert.equal(JSON.parse(chunk.chunk).row.n, sub.n);
  assert.equal(b.get({ action: 'poll', requestId, part: 1 }).error, 'pending');
});

test('private relay rejects malformed requests and reports write errors', () => {
  const b = backend(), requestId = '0123456789abcdef0123456789abcdef';
  assert.equal(b.post({ action: 'relay', requestId, request: 'bad' }).error, 'bad_request');
  assert.equal(b.post({ action: 'relay', requestId, request: { action: 'relay' } }).error, 'bad_request');
  assert.equal(b.post({ action: 'relay', requestId, request:
    { action: 'put', sub: submission(), pin: 'synthetic-model', gate: 'wrong' } }).ok, true);
  assert.equal(JSON.parse(b.get({ action: 'poll', requestId, part: 0 }).chunk).error, 'bad_gate');
  assert.equal(b.tabs.Submissions.rows.length, 1);
});

test('private relay chunks a large roster and polls every part', () => {
  const b = backend();
  for (let i = 0; i < 40; i++) {
    const sub = { ...submission(), e: `synthetic${i}@example.invalid`,
      w: 'x'.repeat(1000) };
    assert.equal(b.post({ action: 'put', sub, pin: 'test-model', gate: 'synthetic-gate' }).ok, true);
  }
  const requestId = 'fedcba9876543210fedcba9876543210';
  assert.equal(b.post({ action: 'relay', requestId,
    request: { action: 'all', key: 'synthetic-admin' } }).ok, true);
  const first = b.get({ action: 'poll', requestId, part: 0 });
  assert.ok(first.parts > 1);
  const raw = Array.from({ length: first.parts }, (_, part) =>
    b.get({ action: 'poll', requestId, part }).chunk).join('');
  assert.equal(JSON.parse(raw).rows.length, 40);
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
