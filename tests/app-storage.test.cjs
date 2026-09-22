const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8');
const source = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(m => m[1]).find(s => s.includes('function cloudPush'));
const sample = () => ({ n: 'Test Attendee', e: 'test@example.invalid', a: 'Test',
  w: 'Research description', c: 'https://example.com', r: ['T1', 'T2', 'T3'],
  q: { T1: 'Question one?', T2: 'Question two?', T3: 'Question three?' }, t: '', read: {} });
const linkHash = sub => '#s=' + Buffer.from(JSON.stringify(sub)).toString('base64url');
const localRecord = (sub, extra = {}) => ({ 'eai.me.v3': JSON.stringify({ sub, pin: 'TestModel', saved: true, ...extra }) });

// Run the real inline application with browser/network boundaries replaced.
// No requests leave this process, and all credentials and responses are synthetic.
function app({ hash = '', search = '', storage = {}, publicURL, api = 'https://script.google.com/macros/s/test/exec',
  reply = () => ({ ok: false, error: 'bad_pin' }), post = () => Promise.resolve({ type: 'opaque' }) } = {}) {
  const nodes = {}, requests = [], scripts = [];
  let nextTimer = 0;
  const pending = new Map();
  function node(id) {
    return nodes[id] ||= { id, style: {}, classList: { add() {}, remove() {}, toggle() {} },
      innerHTML: '', value: '', listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; },
      querySelectorAll() { return []; }, querySelector() { return null; },
      setAttribute() {}, removeAttribute() {}, getAttribute() { return ''; }, scrollIntoView() {} };
  }
  const context = {
    URL, URLSearchParams, TextEncoder, Uint8Array, AbortController, console,
    btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'),
    location: { origin: 'https://app.example.invalid', pathname: '/app/', hash, search },
    history: { replaceState(a, b, url) { const u = new URL(url, context.location.origin);
      context.location.hash = u.hash; context.location.search = u.search; } },
    localStorage: { getItem: k => storage[k] || null, setItem: (k, v) => storage[k] = v, removeItem: k => delete storage[k] },
    navigator: {}, EAI_CONFIG: { apiUrl: api }, EAI_PUBLIC_URL: publicURL, addEventListener() {}, scrollTo() {},
    setTimeout(fn, delay) { const id = ++nextTimer; pending.set(id, { fn, delay });
      if (delay < 2000) queueMicrotask(() => { if (pending.delete(id)) fn(); }); return id; },
    clearTimeout(id) { pending.delete(id); },
    fetch(url, options) { requests.push({ url, options }); return post(url, options); },
    document: { getElementById: node, createElement: () => node('script' + scripts.length),
      head: { appendChild(s) { scripts.push(s.src); s.parentNode = { removeChild() {} };
        const params = new URL(s.src).searchParams;
        queueMicrotask(() => context[params.get('callback')]?.(reply(params))); } },
      body: { classList: { add() {}, remove() {}, toggle() {} } } }
  };
  context.window = context;
  const hooks = `window.test = { state:()=>({S,pin,saved,step,editing,needsPin,syncState,API,mode,pendingPosts,counts}),
    set:s=>{if(s.S)S=s.S;if('pin'in s)pin=s.pin;if('saved'in s)saved=s.saved;if('step'in s)step=s.step;},
    cloudPush,cloudLookup,cloudAll,normalize,sameSubmission,confirmCurrentSave,saveLocal,holdPlace,submit,myLink,decodeAll,readCard,renderReading,renderOrg,wireForm,refreshCounts,keyErrMsg,holdWork,syncFailed,withKey,renderStep0,queueReadSave,flushReadSave,queueDraftSave,saveDraftNow,renderWork,validate,rosterTsv,openThread,openTopic,setRoster:r=>{roster=r} };`;
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, hooks + '})();'), context);
  return { t: context.test, context, storage, requests, scripts, nodes,
    expireTimers(delay) { for (const [id, timer] of pending) {
      if (timer.delay === delay) { pending.delete(id); timer.fn(); }
    } } };
}

test('query-string API overrides cannot redirect credentials', async () => {
  const a = app({ search: '?api=https%3A%2F%2Funtrusted.example.invalid%2Fexec' });
  await assert.rejects(a.t.cloudAll('synthetic-admin-key'));
  assert.equal(a.scripts.length, 1);
  assert.equal(new URL(a.scripts[0]).origin, 'https://script.google.com');
  assert.equal(new URL(a.scripts[0]).searchParams.get('key'), 'synthetic-admin-key');
});

test('manual import accepts multiple wrapped blocks and skips broken or invalid ranks', () => {
  const a = app(); const second = sample(); second.e = 'second@example.invalid';
  const block = sub => '--EAI1--' + Buffer.from(JSON.stringify(sub)).toString('base64url') + '--END--';
  const wrapped = '--EAI1--' + Buffer.from(JSON.stringify(sample())).toString('base64url').replace(/(.{50})/g, '$1\n') + '--END--';
  const invalid = { ...sample(), r: ['T1', 'T1', 'T2'] };
  const imported = a.t.decodeAll('Email text\n' + wrapped + '\n--EAI1--broken--END--\n' + block(invalid) + '\n' + block(second));
  assert.equal(imported.length, 2);
  assert.equal(imported[1].e, second.e);
  assert.equal(a.t.decodeAll('No submission here').length, 0);
});

test('query parameter cannot enable cloud access when deployment has none', async () => {
  const a = app({ api: '', search: '?api=https://untrusted.example.invalid/' });
  await assert.rejects(a.t.cloudPush(sample(), 'test'), e => e.code === 'no_api');
  assert.equal(a.requests.length, 0);
  assert.equal(a.scripts.length, 0);
});

test('old personal link preserves same-attendee draft, key, and editing step', () => {
  const old = sample(), draft = sample(); draft.q.T1 = 'A newer draft question?';
  const a = app({ hash: linkHash(old), storage: localRecord(draft, { editing: true, step: 4 }) });
  assert.equal(a.t.state().S.q.T1, draft.q.T1);
  assert.equal(a.t.state().pin, 'TestModel');
  assert.equal(a.t.state().editing, true);
  assert.equal(a.t.state().step, 4);
  assert.equal(a.context.location.hash, '');
  const reloaded = app({ storage: a.storage });
  assert.equal(reloaded.t.state().S.q.T1, draft.q.T1);
  assert.equal(reloaded.t.state().pin, 'TestModel');
});

test('identity matching normalizes email case and surrounding spaces', () => {
  const linked = sample(); linked.e = ' TEST@EXAMPLE.INVALID ';
  const a = app({ hash: linkHash(linked), storage: localRecord(sample()) });
  assert.equal(a.t.state().pin, 'TestModel');
});

test('a different attendee link never inherits the previous attendee code', () => {
  const linked = sample(); linked.e = 'other@example.invalid';
  const a = app({ hash: linkHash(linked), storage: localRecord(sample()) });
  assert.equal(a.t.state().S.e, linked.e);
  assert.equal(a.t.state().pin, '');
  assert.equal(a.t.state().needsPin, true);
  assert.equal(a.t.state().step, 0);
});

test('new-device import preserves answers and requests the missing personal code', () => {
  const a = app({ hash: linkHash(sample()) });
  assert.equal(a.t.state().S.q.T1, sample().q.T1);
  assert.equal(a.t.state().needsPin, true);
  assert.equal(a.t.state().saved, true);
  assert.equal(a.context.location.hash, '');
});

test('offline personal-link import still opens reading', () => {
  const a = app({ api: '', hash: linkHash(sample()) });
  assert.equal(a.t.state().step, 3);
  assert.equal(a.t.state().needsPin, false);
});

test('old storage format and valid two-character model codes still resume', () => {
  const a = app({ storage: localRecord(sample(), { pin: 'AI' }) });
  assert.equal(a.t.state().step, 3);
  assert.equal(a.t.state().needsPin, false);
});

test('malformed personal link does not destroy a local draft', () => {
  const a = app({ hash: '#s=broken', storage: localRecord(sample()) });
  assert.equal(a.t.state().S.e, sample().e);
  assert.equal(a.t.state().pin, 'TestModel');
});

test('clearing imported data preserves other hash routing', () => {
  const a = app({ api: '', hash: linkHash(sample()) + '&organizer' });
  assert.equal(a.context.location.hash, '#organizer');
});

test('save rejects a stale row despite an opaque successful POST', async () => {
  const stale = sample(); stale.q.T1 = 'Old answer';
  const a = app({ reply: () => ({ ok: true, row: stale }) });
  await assert.rejects(a.t.cloudPush(sample(), 'test-key'), e => e.code === 'unconfirmed');
});

test('a loaded row revision accompanies saves and detects another device change', async () => {
  const initial = sample(), changed = sample();
  changed.q.T1 = 'Newer answer from another device';
  let reads = 0;
  const a = app({ reply: () => ++reads === 1
    ? { ok: true, row: initial, rev: 'first-revision' }
    : { ok: true, row: changed, rev: 'newer-revision' } });
  assert.equal((await a.t.cloudLookup(initial.e, 'test-key')).q.T1, initial.q.T1);
  const stale = sample(); stale.q.T1 = 'Stale local edit';
  await assert.rejects(a.t.cloudPush(stale, 'test-key'), e => e.code === 'conflict');
  assert.equal(JSON.parse(a.requests[0].options.body).ifMatch, 'first-revision');
  await assert.rejects(a.t.cloudPush(stale, 'test-key'), e => e.code === 'conflict');
  assert.equal(JSON.parse(a.requests[1].options.body).ifMatch, 'first-revision');
});

test('a reloaded local draft cannot borrow a newer Sheet revision and overwrite it', async () => {
  const local = sample(), remote = sample();
  local.q.T1 = 'Older local answer';
  remote.q.T1 = 'New answer from another device';
  const a = app({ storage: localRecord(local, { rev: 'old-revision' }),
    reply: () => ({ ok: true, row: remote, rev: 'new-revision' }) });
  await a.t.saveDraftNow();
  assert.equal(a.requests.length, 0);
  assert.equal(a.t.state().S.q.T1, 'Older local answer');
  assert.match(a.t.state().syncState.msg, /changed on another device/);
  assert.match(a.t.state().syncState.msg, /loading the latest reading, which replaces this draft/);
  assert.equal(JSON.parse(a.storage['eai.me.v3']).rev, 'old-revision');
});

test('an offline local edit saves when the Sheet still has its original revision', async () => {
  const local = sample(), remote = sample();
  local.q.T1 = 'Offline local edit';
  let reads = 0;
  const a = app({ storage: localRecord(local, { rev: 'same-revision' }),
    reply: params => params.get('action') === 'get'
      ? (++reads === 1
        ? { ok: true, row: remote, rev: 'same-revision' }
        : { ok: true, row: local, rev: 'saved-revision' })
      : { ok: true, counts: {}, questions: {} } });
  await a.t.saveDraftNow();
  assert.equal(JSON.parse(a.requests[0].options.body).ifMatch, 'same-revision');
  assert.equal(a.t.state().syncState.state, 'ok');
  assert.equal(JSON.parse(a.storage['eai.me.v3']).rev, 'saved-revision');
});

test('save rejects a missing row and preserves authentication errors', async () => {
  const missing = app({ reply: () => ({ ok: true, row: null }) });
  await assert.rejects(missing.t.cloudPush(sample(), 'test-key'), e => e.code === 'unconfirmed');
  assert.equal(JSON.parse(missing.requests[0].options.body).ifMatch, 'absent');
  const refused = app();
  await assert.rejects(refused.t.cloudPush(sample(), 'test-key'), e => e.code === 'bad_pin');
});

test('equivalent response with reordered object keys confirms successfully', async () => {
  const reordered = sample(); reordered.q = { T3: 'Question three?', T1: 'Question one?', T2: 'Question two?' };
  const a = app({ reply: () => ({ ok: true, row: reordered }) });
  assert.equal((await a.t.cloudPush(sample(), 'test-key')).q.T2, 'Question two?');
});

test('save snapshots nested answers and read state before asynchronous changes', async () => {
  const original = sample(); let release;
  const a = app({ reply: () => ({ ok: true, row: sample() }), post: () => new Promise(r => release = r) });
  a.t.set({ S: original });
  const saving = a.t.cloudPush(original, 'test-key');
  original.q.T1 = 'Unsent new answer'; original.read.paper = 1;
  await Promise.resolve();
  release({ type: 'opaque' });
  const row = await saving;
  a.t.confirmCurrentSave(row);
  assert.equal(a.t.state().syncState.state, 'local');
  assert.equal(JSON.parse(a.requests[0].options.body).sub.q.T1, 'Question one?');
  assert.equal(JSON.parse(a.storage['eai.me.v3']).sub.q.T1, 'Unsent new answer');
});

test('exactly confirmed current answers display saved status', () => {
  const a = app(); a.t.set({ S: sample() }); a.t.confirmCurrentSave(sample());
  assert.equal(a.t.state().syncState.state, 'ok');
});

test('editing after a confirmed save clears the old saved status', () => {
  const a = app(); const draft = sample();
  a.t.set({ S: draft }); a.t.confirmCurrentSave(sample());
  draft.q.T1 = 'Changed since confirmation'; a.t.saveLocal();
  assert.equal(a.t.state().syncState.state, 'local');
});

test('submitting and saving topics do not leave stale snapshots in the address bar', () => {
  const a = app({ api: '' }); a.t.set({ S: sample(), pin: 'TestModel' });
  a.t.holdPlace(); assert.equal(a.context.location.hash, '');
  a.t.submit(); assert.equal(a.context.location.hash, '');
  assert.equal(JSON.parse(a.storage['eai.me.v3']).saved, true);
  assert.equal(app({ api: '', storage: a.storage }).t.state().step, 3);
  assert.match(a.t.myLink(sample()), /#s=/); // Explicit sharing remains available.
});

test('native personal links open the public Benchmark app with the same submission', () => {
  const a = app({ publicURL: 'https://www.benchmark.com/evolving-ai/app/' });
  const url = new URL(a.t.myLink(sample()));
  assert.equal(url.origin + url.pathname, 'https://www.benchmark.com/evolving-ai/app/');
  assert.deepEqual(JSON.parse(Buffer.from(url.hash.slice(3), 'base64url').toString()), sample());
  assert.equal(app().t.myLink(sample()).startsWith('https://app.example.invalid/app/#s='), true);
});


test('reading and organizer screens omit article commentary, manual fallback and debriefs', () => {
  const a = app({ api: '', storage: localRecord(sample()) });
  const reading = a.t.renderReading();
  assert.doesNotMatch(reading, /rnote|co-author|Send it to the organizers manually|No sheet is connected|debrief/i);
  assert.match(reading, /role="checkbox" aria-checked="false"/);
  assert.doesNotMatch(reading, /data-opened/);
  assert.doesNotMatch(a.t.renderOrg(), /debrief/i);
});

test('each Read click toggles once and leaves the article controls in place', () => {
  const a = app({ api: '', storage: localRecord(sample()) });
  const tick = { textContent: '' }, attrs = {}, listeners = {};
  const button = { classList: { toggle() {} },
    getAttribute: () => 'https://example.invalid/paper',
    setAttribute: (k,v) => attrs[k] = v,
    querySelector: () => tick, closest: () => ({ classList: { toggle() {} } }),
    addEventListener: (name,fn) => listeners[name] = fn };
  const view = a.nodes.view;
  const original = view.innerHTML;
  view.querySelectorAll = selector => selector === '[data-read]' ? [button] : [];
  a.t.wireForm();
  listeners.click();
  assert.equal(attrs['aria-checked'], 'true');
  assert.equal(tick.textContent, '✓');
  assert.equal(view.innerHTML, original);
  listeners.click();
  assert.equal(attrs['aria-checked'], 'false');
  assert.equal(tick.textContent, '');
  assert.equal(view.innerHTML, original);
  assert.equal(Object.keys(JSON.parse(a.storage['eai.me.v3']).sub.read).length, 0);
});

test('background counts refresh never replaces the current page', async () => {
  const a = app({ reply: () => ({ ok: true, counts: { general: 2 }, questions: {} }) });
  a.nodes.view.innerHTML = 'Current controls and unfinished input';
  await a.t.refreshCounts();
  assert.equal(a.nodes.view.innerHTML, 'Current controls and unfinished input');
});


test('authentication rejection never claims answers are pending based on local saved state', () => {
  for (const saved of [false, true]) {
    const a = app({ api: '' });
    a.t.set({ saved });
    assert.match(a.t.keyErrMsg(), /Could not verify this email and favorite AI model/);
    assert.match(a.t.keyErrMsg(), /does not tell us whether your answers were saved/);
    assert.doesNotMatch(a.t.keyErrMsg(), /Give it a moment|not reached the sheet yet/);
  }
});


test('HTML-only mirrors include the sheet connection without a config.js request', async () => {
  assert.doesNotMatch(html, /<script[^>]+src=["'](?:\.\/)?config\.js["']/);
  const inlineConfig = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).find(s => s.includes('window.EAI_CONFIG ='));
  assert.ok(inlineConfig, 'The published page must carry its own configuration');
  const deployment = { window: {} };
  vm.runInNewContext(inlineConfig, deployment);
  const endpoint = deployment.window.EAI_CONFIG.apiUrl;
  assert.equal(new URL(endpoint).origin, 'https://script.google.com');
  const a = app({ api: endpoint, search: '?api=https://untrusted.example.invalid/exec' });
  assert.match(a.nodes.view.innerHTML, /id="loadMine"/);
  assert.doesNotMatch(a.nodes.view.innerHTML, /Open the link you saved/);
  await assert.rejects(a.t.cloudAll('synthetic-admin'));
  assert.equal(a.scripts[0].split('?')[0], endpoint);
});


test('incomplete credentials remain local without consuming authentication attempts', () => {
  const a = app(); a.t.set({ S: sample(), pin: '', step: 1 });
  a.t.holdWork();
  assert.equal(a.t.state().step, 2);
  assert.equal(JSON.parse(a.storage['eai.me.v3']).step, 2);
  assert.equal(a.requests.length, 0);
  assert.equal(a.scripts.length, 0);
});

test('save authentication failures preserve the current step and display an explanation', () => {
  for (const code of ['locked', 'bad_pin']) {
    const a = app(); a.t.set({ S: sample(), pin: 'TestModel', step: 4 });
    a.t.syncFailed({ code });
    assert.equal(a.t.state().step, 4);
    assert.equal(JSON.parse(a.storage['eai.me.v3']).step, 4);
    assert.equal(a.t.state().S.q.T1, 'Question one?');
    if (code === 'locked') {
      assert.match(a.nodes.view.innerHTML, /Saved on this device only/);
      assert.doesNotMatch(a.nodes.view.innerHTML, /Wait 15 minutes|temporarily locked|personal code is/);
    } else assert.match(a.nodes.view.innerHTML, /favorite AI model/);
  }
});

test('lockout pauses requests for the same email across reloads without blocking other emails', async () => {
  const a = app(); a.t.set({ S: sample(), pin: 'TestModel' });
  let calls = 0;
  const locked = () => { calls++; return Promise.reject({ code: 'locked' }); };
  await assert.rejects(a.t.withKey(locked), e => e.code === 'locked');
  await assert.rejects(a.t.withKey(locked), e => e.code === 'locked');
  assert.equal(calls, 1);
  const b = app({ storage: a.storage }); b.t.set({ S: sample(), pin: 'TestModel' });
  await assert.rejects(b.t.withKey(locked), e => e.code === 'locked');
  assert.equal(calls, 1);
  b.t.set({ S: { ...sample(), e: 'another@example.invalid' } });
  assert.equal(await b.t.withKey(() => Promise.resolve('allowed')), 'allowed');
  a.storage['eai.lock.v1:test@example.invalid'] = JSON.stringify(Date.now() - 1);
  assert.equal(await a.t.withKey(() => Promise.resolve('expired')), 'expired');
});


test('invitation passcode remains visible for new and returning attendees', () => {
  for (const saved of [false, true]) {
    const a = app({ api: '', storage: { 'eai.gate.v1': JSON.stringify('accepted-test-code') } });
    a.t.set({ saved });
    assert.match(a.t.renderStep0(), /id="fgate"/);
    assert.match(a.t.renderStep0(), /Invitation passcode/);
  }
});


test('reading progress saves and confirms before any questions are submitted', async () => {
  const sub = sample(); sub.q = {}; sub.read = { 'https://example.invalid/paper': 1 };
  let stored;
  const a = app({ post: (url, opts) => { stored = JSON.parse(opts.body).sub; return Promise.resolve({type:'opaque'}); },
    reply: () => ({ ok: true, row: stored }) });
  a.t.set({ S: sub, pin: 'TestModel', saved: true });
  await a.t.saveDraftNow();
  assert.equal(a.t.state().syncState.state, 'ok');
  assert.equal(Object.keys(stored.q).length, 0);
  assert.equal(stored.read['https://example.invalid/paper'], 1);
});

test('an unconfirmed background reading save never claims success', async () => {
  const sub = sample(); sub.q = {};
  const a = app({ reply: () => ({ ok: true, row: { ...sub, read: {} } }) });
  sub.read = { 'https://example.invalid/paper': 1 };
  a.t.set({ S: sub, pin: 'TestModel', saved: true });
  await a.t.saveDraftNow();
  assert.equal(a.t.state().syncState.state, 'local');
  assert.match(a.t.state().syncState.msg, /Could not confirm/);
});

test('rapid reading changes serialize saves and confirm the newest state', async () => {
  let release, stored, active = 0, peak = 0;
  const a = app({ post: (url, opts) => {
    stored = JSON.parse(opts.body).sub; active++; peak = Math.max(peak, active);
    return new Promise(resolve => { release = () => { active--; resolve({type:'opaque'}); }; });
  }, reply: () => ({ ok: true, row: stored }) });
  const sub = sample(); sub.q = {};
  a.t.set({ S: sub, pin: 'TestModel', saved: true });
  const first = a.t.saveDraftNow();
  for(let i=0;i<30 && !release;i++) await Promise.resolve();
  sub.read['https://example.invalid/paper'] = 1;
  a.t.saveDraftNow(); release();
  for(let i = 0; i < 30 && a.requests.length < 2; i++) await Promise.resolve();
  assert.equal(a.requests.length, 2); release(); await first;
  assert.equal(peak, 1);
  assert.equal(stored.read['https://example.invalid/paper'], 1);
  assert.equal(a.t.state().syncState.state, 'ok');
});


test('personal information saves before topics and questions exist', async () => {
  const sub = sample(); sub.r = ['', '', '']; sub.q = {}; sub.w = '';
  let stored;
  const a = app({ storage: { 'eai.gate.v1': JSON.stringify('synthetic-gate') },
    post: (url, opts) => { stored = JSON.parse(opts.body).sub; return Promise.resolve({type:'opaque'}); },
    reply: () => ({ok:true, row:stored}) });
  a.t.set({ S: sub, pin: 'TestModel' });
  a.t.queueDraftSave();
  for(let i=0;i<40 && a.t.state().syncState.state !== 'ok';i++) await Promise.resolve();
  assert.equal(a.t.state().syncState.state, 'ok');
  assert.equal(stored.e, sub.e);
  assert.deepEqual(stored.r, ['', '', '']);
  assert.equal(a.t.state().saved, false);
  sub.a = 'Updated affiliation';
  a.t.queueDraftSave();
  for(let i=0;i<40 && stored.a !== sub.a;i++) await Promise.resolve();
  assert.equal(stored.a, 'Updated affiliation');
});

test('rejected credentials do not create an automatic save retry loop', async () => {
  const a = app(); a.t.set({S:sample(),pin:'TestModel'});
  await a.t.saveDraftNow();
  const attempts = a.requests.length;
  await a.t.saveDraftNow();
  assert.equal(a.requests.length, attempts);
  assert.equal(a.t.state().syncState.state, 'local');
  assert.match(a.t.state().syncState.msg, /sheet rejected/);
});


test('first autosave preserves an existing attendee’s topics and questions', async () => {
  const existing = sample(); existing.read.paper = 1;
  existing.hopes = 'Shared understanding'; existing.moreWork = 'Further research notes';
  let stored = existing;
  const a = app({ post: (url, opts) => { stored = JSON.parse(opts.body).sub; return Promise.resolve({type:'opaque'}); },
    reply: () => ({ok:true,row:stored}) });
  a.t.set({S:{...sample(),r:['','',''],q:{},read:{},w:''},pin:'TestModel'});
  await a.t.saveDraftNow();
  assert.deepEqual(stored.r, existing.r);
  assert.equal(stored.q.T1, existing.q.T1);
  assert.equal(stored.read.paper, 1);
  assert.equal(stored.hopes, existing.hopes);
  assert.equal(stored.moreWork, existing.moreWork);
  assert.equal(a.t.state().syncState.state,'ok');
});

test('stalled upload times out, preserves draft, and allows a successful retry', async () => {
  let stored, releaseStalled, uploads = 0;
  const a = app({ reply: () => ({ ok: true, row: stored }), post: (url, options) => {
    uploads++;
    if (uploads === 1) return new Promise(resolve => { releaseStalled = resolve; });
    stored = JSON.parse(options.body).sub;
    return Promise.resolve({ type: 'opaque' });
  } });
  const sub = sample();
  a.t.set({ S: sub, pin: 'TestModel', saved: true });
  const first = a.t.saveDraftNow();
  for (let i = 0; i < 40 && !a.requests.length; i++) await Promise.resolve();
  assert.equal(a.nodes.retrySync.disabled, true);
  assert.equal(a.nodes.retrySync.textContent, 'Saving…');
  a.t.wireForm();
  a.nodes.retrySync.listeners.click();
  a.nodes.retrySync.listeners.click();
  assert.equal(uploads, 1);
  a.expireTimers(12000);
  await first;
  assert.equal(a.requests[0].options.signal.aborted, true);
  assert.equal(a.t.state().syncState.state, 'local');
  assert.match(a.t.state().syncState.msg, /did not respond in time/);
  assert.equal(a.nodes.retrySync.disabled, false);
  assert.equal(JSON.parse(a.storage['eai.me.v3']).sub.q.T1, sub.q.T1);
  await a.t.saveDraftNow();
  assert.equal(uploads, 2);
  assert.equal(a.t.state().syncState.state, 'ok');
  // A late resolution of the expired upload must not start a stale read-back.
  const reads = a.scripts.length;
  releaseStalled({ type: 'opaque' });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(a.scripts.length, reads);
  assert.equal(a.t.state().syncState.state, 'ok');
});

test('work fields autosave, restore, export, and allow clearing optional details', async () => {
  const sub = { ...sample(), hopes: 'Build shared understanding — I can contribute research.', moreWork: 'Longer article: https://example.com/research\nMore context.' };
  let stored;
  const a = app({ reply: () => ({ ok: true, row: stored }), post: (url, opts) => {
    stored = JSON.parse(opts.body).sub; return Promise.resolve({ type: 'opaque' });
  } });
  a.t.set({ S: sub, pin: 'TestModel' });
  await a.t.saveDraftNow();
  assert.equal(stored.hopes, sub.hopes);
  assert.equal(stored.moreWork, sub.moreWork);
  const restored = app({ storage: a.storage });
  assert.equal(restored.t.state().S.hopes, sub.hopes);
  assert.equal(restored.t.state().S.moreWork, sub.moreWork);
  const linked = app({ hash: linkHash(sub) });
  assert.equal(linked.t.state().S.hopes, sub.hopes);
  a.t.setRoster([stored]);
  assert.match(a.t.rosterTsv(), /Gathering goals and contribution\tMore work details \(optional\)/);
  assert.match(a.t.rosterTsv(), /Build shared understanding/);
  sub.moreWork = '';
  await a.t.saveDraftNow();
  assert.equal(stored.moreWork, '');
  assert.equal(a.t.state().syncState.state, 'ok');
});

test('work validation requires gathering goals but leaves further details optional', () => {
  const a = app();
  const sub = { ...sample(), hopes: '', moreWork: '' };
  a.t.set({ S: sub });
  assert.equal(a.t.validate(1), false);
  assert.match(a.t.renderWork(), /Briefly describe your hopes/);
  sub.hopes = 'Learn from others and contribute my research.';
  assert.equal(a.t.validate(1), true);
  assert.match(a.t.renderWork().replace(/<[^>]*>/g, ''), /Optional: More detail describing your work/);
  const old = a.t.normalize(sample());
  assert.equal(old.hopes, ''); assert.equal(old.moreWork, '');
});

for (const entry of ['next', 'editMine']) {
  test(`${entry === 'next' ? 'Write my questions' : 'Edit answers'} then Back preserves the full reading page after reload`, () => {
    const sub = { ...sample(), q: {}, read: { paper: 1 } };
    const a = app({ api: '', storage: localRecord(sub, { step: 3 }) });
    a.nodes[entry].listeners.click();
    assert.equal(a.t.state().step, 4);
    assert.equal(JSON.parse(a.storage['eai.me.v3']).step, 4);
    a.t.state().S.q.T1 = 'A question still in progress';
    a.nodes.back.listeners.click();
    assert.equal(a.t.state().step, 3);
    assert.equal(a.t.state().editing, false);
    const restored = app({ api: '', storage: a.storage });
    assert.equal(restored.t.state().step, 3);
    assert.equal(restored.t.state().S.q.T1, 'A question still in progress');
    assert.equal(restored.t.state().S.read.paper, 1);
    for (const instance of [a, restored]) {
      for (const control of ['readingProgress', 'copyLink', 'copyRead', 'data-read', 'openGeneral']) {
        assert.ok(instance.nodes.view.innerHTML.includes(control), `Missing ${control}`);
      }
    }
  });
}

test('an older editing session still shows all reading controls and clear save wording', () => {
  const a = app({ storage: localRecord(sample(), { step: 3, editing: true }) });
  const reading = a.t.renderReading();
  for (const control of ['readingProgress', 'copyLink', 'copyRead', 'data-read', 'openGeneral']) {
    assert.ok(reading.includes(control), `Missing ${control}`);
  }
  assert.match(reading, />Save my progress<\/button>/);
  assert.doesNotMatch(reading, /Saves your answers and reading status online/);
  assert.doesNotMatch(reading, /Try the sheet again/);
});

test('an unconfirmed discussion post keeps its text and reuses the same ID on retry', async () => {
  const a = app({ storage: localRecord(sample()),
    reply: params => params.get('action') === 'posts' ? { ok: true, posts: [] }
      : { ok: true, counts: {}, questions: {} } });
  a.t.openThread('general', '');
  await new Promise(setImmediate);
  a.context.document.getElementById('fpost').value = 'A synthetic comment';
  a.nodes.sendPost.listeners.click();
  await new Promise(setImmediate);
  const first = JSON.parse(a.requests.find(r => JSON.parse(r.options.body).action === 'post').options.body);
  assert.match(first.id, /^p[0-9a-f]{32}$/);
  assert.equal(a.nodes.fpost.value, first.body);
  assert.equal(a.nodes.sendPost.disabled, false);
  assert.equal(JSON.parse(a.storage['eai.post.pending.v1'])[0].id, first.id);
  const reloaded = app({ storage: a.storage,
    reply: params => params.get('action') === 'posts' ? { ok: true, posts: [] }
      : { ok: true, counts: {}, questions: {} } });
  reloaded.t.openThread('general', '');
  await new Promise(setImmediate);
  assert.equal(reloaded.nodes.fpost.value, first.body);
  a.nodes.sendPost.listeners.click();
  await new Promise(setImmediate);
  const writes = a.requests.filter(r => JSON.parse(r.options.body).action === 'post');
  assert.equal(JSON.parse(writes[1].options.body).id, first.id);
});

test('uncertain posts in two threads keep separate retry IDs', async () => {
  const a = app({ storage: localRecord(sample()),
    reply: params => params.get('action') === 'posts' ? { ok: true, posts: [] }
      : { ok: true, counts: {}, questions: {} } });
  a.t.openThread('general', '');
  await new Promise(setImmediate);
  a.nodes.fpost.value = 'First uncertain comment';
  a.nodes.sendPost.listeners.click();
  await new Promise(setImmediate);
  const firstId = JSON.parse(a.requests[0].options.body).id;
  a.t.openThread('topic:T1', '');
  await new Promise(setImmediate);
  a.nodes.fpost.value = 'Second uncertain comment';
  a.nodes.sendPost.listeners.click();
  await new Promise(setImmediate);
  const secondId = JSON.parse(a.requests[1].options.body).id;
  assert.notEqual(firstId, secondId);
  // The mock reuses one textarea object; real render() creates a fresh node.
  a.nodes.fpost.value = '';
  a.t.openThread('general', '');
  await new Promise(setImmediate);
  assert.equal(a.nodes.fpost.value, 'First uncertain comment');
  a.nodes.sendPost.listeners.click();
  await new Promise(setImmediate);
  assert.equal(JSON.parse(a.requests[2].options.body).id, firstId);
  assert.equal(JSON.parse(a.storage['eai.post.pending.v1']).length, 2);
});

test('a matching post ID confirms the discussion write and clears its pending retry', async () => {
  let posted;
  const a = app({ storage: localRecord(sample()),
    post: (url, options) => { posted = JSON.parse(options.body); return Promise.resolve({ type: 'opaque' }); },
    reply: params => params.get('action') === 'posts'
      ? { ok: true, posts: posted ? [{ id: posted.id, mine: true, body: posted.body }] : [] }
      : { ok: true, counts: {}, questions: {} } });
  a.t.openThread('general', '');
  await new Promise(setImmediate);
  a.context.document.getElementById('fpost').value = 'A synthetic comment';
  a.nodes.sendPost.listeners.click();
  await new Promise(setImmediate);
  assert.equal(a.t.state().pendingPosts.length, 0);
  assert.equal(a.storage['eai.post.pending.v1'], undefined);
});

test('a late topic response cannot update a different discussion page', async () => {
  const a = app({ storage: localRecord(sample()), reply: params => {
    if (params.get('action') === 'topic') return { ok: true, questions: [], posts: [{ id: 'old' }] };
    if (params.get('action') === 'posts') return { ok: true, posts: [] };
    return { ok: true, counts: {}, questions: {} };
  } });
  a.t.openTopic('T1');
  a.t.openThread('general', '');
  await new Promise(setImmediate);
  assert.equal(a.t.state().mode, 'thread');
  assert.equal(a.t.state().counts.general || 0, 0);
});
