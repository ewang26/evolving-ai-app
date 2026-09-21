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
function app({ hash = '', search = '', storage = {}, api = 'https://script.google.com/macros/s/test/exec',
  reply = () => ({ ok: false, error: 'bad_pin' }), post = () => Promise.resolve({ type: 'opaque' }) } = {}) {
  const nodes = {}, requests = [], scripts = [];
  let nextTimer = 0;
  const pending = new Set();
  function node(id) {
    return nodes[id] ||= { id, style: {}, classList: { add() {}, remove() {}, toggle() {} },
      innerHTML: '', value: '', listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; },
      querySelectorAll() { return []; }, querySelector() { return null; },
      setAttribute() {}, removeAttribute() {}, getAttribute() { return ''; }, scrollIntoView() {} };
  }
  const context = {
    URL, URLSearchParams, TextEncoder, Uint8Array, console,
    btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'),
    location: { origin: 'https://app.example.invalid', pathname: '/app/', hash, search },
    history: { replaceState(a, b, url) { const u = new URL(url, context.location.origin);
      context.location.hash = u.hash; context.location.search = u.search; } },
    localStorage: { getItem: k => storage[k] || null, setItem: (k, v) => storage[k] = v, removeItem: k => delete storage[k] },
    navigator: {}, EAI_CONFIG: { apiUrl: api }, addEventListener() {}, scrollTo() {},
    setTimeout(fn, delay) { const id = ++nextTimer; pending.add(id);
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
  const hooks = `window.test = { state:()=>({S,pin,saved,step,editing,needsPin,syncState,API}),
    set:s=>{if(s.S)S=s.S;if('pin'in s)pin=s.pin;if('saved'in s)saved=s.saved;},
    cloudPush,cloudAll,normalize,sameSubmission,confirmCurrentSave,saveLocal,holdPlace,submit,myLink,decodeAll };`;
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, hooks + '})();'), context);
  return { t: context.test, context, storage, requests, scripts };
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

test('save rejects a missing row and preserves authentication errors', async () => {
  const missing = app({ reply: () => ({ ok: true, row: null }) });
  await assert.rejects(missing.t.cloudPush(sample(), 'test-key'), e => e.code === 'unconfirmed');
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
