const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { backend } = require('./helpers/sheet-backend.cjs');

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
function app({ hash = '', search = '', storage = {}, publicURL, bridge = false, now, relay, digest, autoDraftTimers = true,
  api = 'https://script.google.com/macros/s/test/exec',
  reply = () => ({ ok: false, error: 'bad_pin' }), post = () => Promise.resolve({ type: 'opaque' }) } = {}) {
  const nodes = {}, requests = [], scripts = [], relayResponses = new Map(), listeners = {};
  let nextTimer = 0;
  let nonceByte = 0;
  const pending = new Map();
  function node(id) {
    return nodes[id] ||= { id, style: {}, classList: { add() {}, remove() {}, toggle() {} },
      innerHTML: '', value: '', listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; },
      querySelectorAll() { return []; }, querySelector() { return null; },
      setAttribute() {}, removeAttribute() {}, getAttribute() { return ''; }, scrollIntoView() {} };
  }
  const context = {
    URL, URLSearchParams, TextEncoder, Uint8Array, AbortController, console,
    Date: now === undefined ? Date : class extends Date { static now() { return now; } },
    btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'),
    location: { origin: 'https://app.example.invalid', pathname: '/app/', hash, search },
    history: { replaceState(a, b, url) { const u = new URL(url, context.location.origin);
      context.location.hash = u.hash; context.location.search = u.search; } },
    localStorage: { getItem: k => storage[k] || null, setItem: (k, v) => storage[k] = v, removeItem: k => delete storage[k] },
    navigator: {}, EAI_CONFIG: { apiUrl: api, bridge }, EAI_PUBLIC_URL: publicURL,
    crypto: { subtle: { digest: digest || ((algorithm, bytes) => require('node:crypto').webcrypto.subtle.digest(algorithm, bytes)) }, getRandomValues(bytes) { bytes.forEach((_, i) => bytes[i] = ++nonceByte % 256); return bytes; } },
    addEventListener(event, fn) { (listeners[event] ||= new Set()).add(fn); },
    removeEventListener(event, fn) { listeners[event]?.delete(fn); }, scrollTo() {},
    setTimeout(fn, delay) { const id = ++nextTimer; pending.set(id, { fn, delay });
      if (delay < 2000 && (autoDraftTimers || delay !== 1800)) queueMicrotask(() => { if (pending.delete(id)) fn(); }); return id; },
    clearTimeout(id) { pending.delete(id); },
    fetch(url, options) {
      requests.push({ url, options });
      if (bridge && options.body) {
        const envelope = JSON.parse(options.body);
        if (envelope.action === 'relay') {
          const response = relay ? relay(envelope.request) : reply(new URLSearchParams(envelope.request));
          return Promise.resolve(response).then(result => {
            relayResponses.set(envelope.requestId, JSON.stringify(result));
            return { type: 'opaque' };
          });
        }
      }
      return post(url, options);
    },
    document: { getElementById: node, createElement(tag) {
      return node('script' + scripts.length);
    },
      head: { appendChild(s) { scripts.push(s.src); s.parentNode = { removeChild() {} };
        const params = new URL(s.src).searchParams;
        queueMicrotask(() => {
          let result;
          if (params.get('action') === 'poll') {
            const response = relayResponses.get(params.get('requestId'));
            const part = Number(params.get('part'));
            const chunks = response?.match(/[\s\S]{1,25000}/g) || [];
            result = chunks[part] === undefined ? { ok: false, error: 'pending' }
              : { ok: true, parts: chunks.length, part, chunk: chunks[part] };
          } else result = reply(params);
          context[params.get('callback')]?.(result);
        }); } },
      body: { classList: { add() {}, remove() {}, toggle() {} }, appendChild(element) {
        element.parentNode = { removeChild() {} };
      } } }
  };
  context.window = context;
  const hooks = `window.test = { state:()=>({S,pin,saved,step,editing,identityEditing,needsPin,gateOk,syncState,API,mode,pendingPosts,counts}),
    set:s=>{if(s.S)S=s.S;if('pin'in s)pin=s.pin;if('saved'in s)saved=s.saved;if('step'in s)step=s.step;if('identityEditing'in s)identityEditing=s.identityEditing;},
    loadAssignments,renderAssignedGroups,renderSchedule,requiredReadings,renderProgress,wireProgress,loadParticipants,participantOptions,renderOneOnOne,mergeDraft,cloudPush,cloudLookup,cloudAll,cloudGate,normalize,sameSubmission,confirmCurrentSave,saveLocal,holdPlace,submit,myLink,decodeAll,readCard,renderReading,renderStep1,renderOrg,wireForm,refreshCounts,keyErrMsg,holdWork,syncFailed,withKey,renderStep0,queueReadSave,flushReadSave,queueDraftSave,saveDraftNow,renderWork,validate,rosterTsv,openThread,openTopic,setRoster:r=>{roster=r} };`;
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, hooks + '})();'), context);
  return { t: context.test, context, storage, requests, scripts, nodes,
    expireTimers(delay) { for (const [id, timer] of pending) {
      if (timer.delay === delay) { pending.delete(id); timer.fn(); }
    } } };
}

test('the app closes on November 10 without changing local data or contacting the Sheet', () => {
  const sub = sample();
  const storage = localRecord(sub);
  const before = storage['eai.me.v3'];
  const a = app({ now: Date.UTC(2026, 10, 10, 8, 0, 0), storage });
  assert.match(a.nodes.view.innerHTML, /Evolving AI preparation has closed/);
  assert.equal(a.nodes.bar.hidden, true);
  assert.equal(a.nodes.homeBtn.disabled, true);
  assert.equal(a.requests.length, 0);
  assert.equal(storage['eai.me.v3'], before);
});

test('query-string API overrides cannot redirect credentials', async () => {
  const a = app({ search: '?api=https%3A%2F%2Funtrusted.example.invalid%2Fexec' });
  await assert.rejects(a.t.cloudAll('synthetic-admin-key'));
  assert.equal(a.scripts.length, 1);
  assert.equal(new URL(a.scripts[0]).origin, 'https://script.google.com');
  assert.equal(new URL(a.scripts[0]).searchParams.get('key'), 'synthetic-admin-key');
});

test('private relay sends reads in a POST body and polls with a random ticket', async () => {
  const a = app({ bridge: true, reply: () => ({ ok: true, row: sample(), rev: 'test-rev' }) });
  const row = await a.t.cloudLookup(sample().e, 'synthetic-model');
  assert.equal(row.e, sample().e);
  assert.equal(a.requests.length, 1);
  assert.equal(a.requests[0].url, 'https://script.google.com/macros/s/test/exec');
  const envelope = JSON.parse(a.requests[0].options.body);
  assert.equal(envelope.action, 'relay');
  assert.equal(envelope.request.pin, 'synthetic-model');
  assert.equal(envelope.request.action, 'get');
  assert.equal(new URL(a.scripts[0]).searchParams.get('action'), 'poll');
  assert.doesNotMatch(a.scripts[0], /synthetic-model|test%40example/);
});

test('invitation validation uses the backend and keeps the code out of the URL', async () => {
  const a = app({ bridge: true, reply: p => ({ ok: true, valid: p.get('code') === 'synthetic-gate' }) });
  assert.equal(await a.t.cloudGate('wrong'), false);
  assert.equal(await a.t.cloudGate('synthetic-gate'), true);
  assert.equal(a.requests.length, 2);
  assert.equal(JSON.parse(a.requests[1].options.body).request.code, 'synthetic-gate');
  assert.equal(a.scripts.length, 2);
  assert.ok(a.scripts.every(url => !url.includes('synthetic-gate')));
  const failed = app({ bridge: true, reply: () => ({ ok: false, error: 'backend_error' }) });
  await assert.rejects(failed.t.cloudGate('synthetic-gate'), e => e.code === 'backend_error');
  await assert.rejects(app({ api: '' }).t.cloudGate('synthetic-gate'), e => e.code === 'no_api');
});

test('a failed invitation check leaves Continue usable and the draft intact', async () => {
  const a = app({ bridge: true, reply: p => p.get('action') === 'get'
    ? { ok: true, row: null } : { ok: false, error: 'backend_error' } });
  a.t.set({ S: sample(), pin: 'TestModel', saved: false, step: 0 });
  a.t.wireForm();
  a.nodes.fgate.value = 'synthetic-gate';
  a.nodes.fgate.listeners.input();
  a.nodes.next.listeners.click();
  for (let i = 0; i < 30 && a.nodes.next.disabled; i++) await Promise.resolve();
  assert.equal(a.t.state().step, 0);
  assert.equal(a.nodes.next.disabled, false);
  assert.match(a.nodes.view.innerHTML, /Could not verify the passcode right now/);
  assert.equal(a.t.state().S.e, sample().e);
});

test('private relay surfaces a rejected write without claiming a save', async () => {
  const a = app({ bridge: true, reply: () => ({ ok: false, error: 'bad_gate' }) });
  await assert.rejects(a.t.cloudPush(sample(), 'synthetic-model'), e => e.code === 'bad_gate');
  assert.equal(a.requests.length, 1);
  assert.equal(JSON.parse(a.requests[0].options.body).request.action, 'put');
  assert.equal(JSON.parse(a.requests[0].options.body).request.gate, '');
  assert.equal(new URL(a.scripts[0]).searchParams.get('action'), 'poll');
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

test('old personal link preserves the draft but purges the stored personal code', () => {
  const old = sample(), draft = sample(); draft.q.T1 = 'A newer draft question?';
  const a = app({ hash: linkHash(old), storage: localRecord(draft, { editing: true, step: 4 }) });
  assert.equal(a.t.state().S.q.T1, draft.q.T1);
  assert.equal(a.t.state().pin, 'TestModel');
  assert.equal(a.t.state().editing, true);
  assert.equal(a.t.state().step, 4);
  assert.equal(a.context.location.hash, '');
  assert.equal(Object.hasOwn(JSON.parse(a.storage['eai.me.v3']), 'pin'), false);
  const reloaded = app({ storage: a.storage });
  assert.equal(reloaded.t.state().S.q.T1, draft.q.T1);
  assert.equal(reloaded.t.state().pin, '');
  assert.equal(reloaded.t.state().needsPin, false);
});

test('an invitation code left by an older release is removed from browser storage', async () => {
  const storage = { 'eai.gate.v1': JSON.stringify('synthetic-invitation-code') };
  const a = app({ storage, reply: p => p.get('action') === 'get'
    ? { ok: true, row: null } : { ok: true, valid: false } });
  assert.equal(storage['eai.gate.v1'], undefined);
  assert.equal(a.t.state().gateOk, false);
  a.t.set({ S: sample(), pin: 'TestModel', saved: false, step: 0 });
  a.t.wireForm();
  a.nodes.next.listeners.click();
  await new Promise(setImmediate);
  assert.equal(a.t.state().step, 0);
  const gateChecks = a.scripts.map(url => new URL(url).searchParams)
    .filter(p => p.get('action') === 'gate');
  assert.equal(gateChecks.length, 1); // the old code is sent for a fresh server check
  assert.equal(gateChecks[0].get('code'), 'synthetic-invitation-code');
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
  assert.equal(a.t.state().needsPin, false);
  assert.equal(a.t.state().step, 3);
});

test('new-device import preserves answers without requiring a model', () => {
  const a = app({ hash: linkHash(sample()) });
  assert.equal(a.t.state().S.q.T1, sample().q.T1);
  assert.equal(a.t.state().needsPin, false);
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
  assert.match(a.t.state().syncState.msg, /different answers/);
  assert.match(a.t.state().syncState.msg, /Review the differences/);
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
  assert.equal(a.t.myLink(sample()), 'https://app.example.invalid/app/');
});

test('new shared links contain no attendee data and old links still import', () => {
  const a = app({ publicURL: 'https://www.benchmark.com/evolving-ai/app/' });
  const url = new URL(a.t.myLink(sample()));
  assert.equal(url.href, 'https://www.benchmark.com/evolving-ai/app/');
  assert.equal(url.hash, '');
  assert.equal(app().t.myLink(sample()), 'https://app.example.invalid/app/');
  const old = app({ hash: linkHash(sample()) });
  assert.equal(old.t.state().S.e, sample().e);
});

test('old organizer key and roster are removed from persistent browser storage', () => {
  const storage = { 'eai.adminkey.v1': JSON.stringify('synthetic-key'),
    'eai.roster.v3': JSON.stringify([sample()]) };
  const a = app({ storage });
  assert.equal(storage['eai.adminkey.v1'], undefined);
  assert.equal(storage['eai.roster.v3'], undefined);
  assert.doesNotMatch(a.t.renderOrg(), /Test Attendee/);
});

test('leaving the organizer console clears the in-memory roster and key', () => {
  const a = app({ hash: '#organizer' });
  a.t.setRoster([sample()]);
  assert.match(a.t.renderOrg(), /Test Attendee/);
  a.nodes.homeBtn.listeners.click();
  assert.doesNotMatch(a.t.renderOrg(), /Test Attendee/);
  assert.equal(a.storage['eai.roster.v3'], undefined);
  assert.equal(a.storage['eai.adminkey.v1'], undefined);
});


test('reading and organizer screens omit article commentary, manual fallback and debriefs', () => {
  const a = app({ api: '', storage: localRecord(sample()) });
  const reading = a.t.renderReading();
  assert.doesNotMatch(reading, /rnote|co-author|Send it to the organizers manually|No sheet is connected|debrief/i);
  assert.match(reading, /role="checkbox" aria-checked="false"/);
  assert.doesNotMatch(reading, /data-opened/);
  assert.doesNotMatch(a.t.renderOrg(), /debrief/i);
});

test('unselected topics appear in a collapsed optional reading section', () => {
  for (const [selected, unselectedTitles] of [
    [['T1', 'T2', 'T3'], ['Human–AI Coevolution', 'Steering Open-Ended AI Ecosystems', 'Collective Intelligence']],
    [['T4', 'T5', 'T6'], ['AI as a Major Evolutionary Transition', 'From Adaptive Agents to Adaptive Wholes', 'Regulation, Cheating, and Systemic Breakdown']]
  ]) {
    const a = app({ api: '', storage: localRecord({ ...sample(), r: selected }) });
    const reading = a.t.renderReading();
    const section = reading.match(/<div class="topicblock other-topics">([\s\S]*?)<\/details><\/div>/)?.[1];
    assert.ok(section);
    assert.match(section, /^<div class="eyebrow">Topics not selected<\/div><details>/);
    assert.match(section, /<summary><span>See <strong>optional<\/strong> readings from other topics<\/span><\/summary>/);
    for (const title of unselectedTitles) assert.ok(section.includes(title), title);
    assert.equal((section.match(/<span class="tag">Optional<\/span>/g) || []).length, 6);
    assert.doesNotMatch(section, /data-read=|role="checkbox"|<span class="tag req">Required<\/span>/);
    assert.doesNotMatch(section, /<details open/);
    assert.equal((reading.match(/<span class="tag req">Required<\/span>/g) || []).length, 4);
  }
});

test('topic choices keep their saved IDs without repeating topic numbers beside rank badges', () => {
  const a = app({ api: '', storage: localRecord(sample()) });
  const choices = a.t.renderStep1();
  for (const id of ['T1', 'T2', 'T3', 'T4', 'T5', 'T6']) {
    assert.match(choices, new RegExp(`<option value="${id}"`));
  }
  assert.match(choices, /class="ord">1st<\/div>/);
  assert.doesNotMatch(choices, /<option[^>]*>\d+ — /);
});

test('reading cards lead with titles and omit page-count metadata', () => {
  const a = app({ api: '', storage: localRecord(sample()) });
  const reading = a.t.renderReading();
  assert.match(reading, /<span class="rtitle">Evolvable AI: Threats of a new major transition in evolution<\/span>/);
  assert.match(reading, /<span class="rby">V\. Müller, L\. Steels &amp; E\. Szathmáry · 2026<\/span>/);
  assert.equal((reading.match(/class="rtitle"/g) || []).length, 13);
  assert.doesNotMatch(reading, /\b\d+ pp\b|class="rkind"/);
});

test('seminar prep restores the overall progress percentage and navigation', () => {
  const a = app({ api: '', storage: localRecord(sample()) });
  const reading = a.t.renderReading();
  assert.match(reading, /Your <em>seminar prep\.<\/em>/);
  assert.match(reading, /<span class="pgpct">60<i>%<\/i><\/span>/);
  assert.match(reading, /aria-label="Overall preparation complete"[^>]*aria-valuenow="60"/);
  for (const target of ['0', 'topics', 'reads', 'questions']) {
    assert.match(reading, new RegExp(`data-go="${target}"`));
  }
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
    assert.match(a.t.keyErrMsg(), /Could not verify this name and email/);
    assert.match(a.t.keyErrMsg(), /does not tell us whether your answers were saved/);
    assert.doesNotMatch(a.t.keyErrMsg(), /Give it a moment|not reached the sheet yet/);
  }
});


test('HTML-only mirrors include the sheet connection without a config.js request', async () => {
  assert.doesNotMatch(html, /<script[^>]+src=["'](?:\.\/)?config\.js["']/);
  const inlineConfig = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).find(s => s.includes('window.EAI_CONFIG ='));
  assert.ok(inlineConfig, 'The published page must carry its own configuration');
  const deployment = { window: {}, URLSearchParams, location: { search: '' } };
  vm.runInNewContext(inlineConfig, deployment);
  const endpoint = deployment.window.EAI_CONFIG.apiUrl;
  assert.equal(new URL(endpoint).origin, 'https://script.google.com');
  assert.equal(deployment.window.EAI_CONFIG.bridge, true);
  const relayPreview = { window: {}, URLSearchParams, location: { search: '?relay_test=1' } };
  vm.runInNewContext(inlineConfig, relayPreview);
  assert.equal(relayPreview.window.EAI_CONFIG.bridge, true);
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
      assert.match(a.nodes.view.innerHTML, /Saved on this device\. Latest sheet save unconfirmed/);
      assert.doesNotMatch(a.nodes.view.innerHTML, /Wait 15 minutes|temporarily locked|personal code is/);
    } else assert.match(a.nodes.view.innerHTML, /name and email/);
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

test('loading a reading clears in-progress identity editing so later changes save', async () => {
  let stored = sample();
  const a = app({
    reply: () => ({ ok: true, row: stored, rev: 'test-revision' }),
    post: (url, opts) => {
      stored = JSON.parse(opts.body).sub;
      return Promise.resolve({ type: 'opaque' });
    }
  });
  a.t.set({ S: sample(), pin: 'TestModel', identityEditing: true });
  a.t.wireForm();
  // Load can complete before the email field's change event resets this flag.
  a.nodes.loadMine.listeners.click();
  for (let i = 0; i < 30 && !a.t.state().saved; i++) await Promise.resolve();
  assert.equal(a.t.state().saved, true);
  assert.equal(a.t.state().identityEditing, false);
  a.t.state().S.read['https://example.invalid/paper'] = 1;
  await a.t.saveDraftNow();
  assert.equal(a.requests.length, 1);
  assert.equal(stored.read['https://example.invalid/paper'], 1);
  assert.equal(a.t.state().syncState.state, 'ok');
});

for (const complete of [true, false]) {
  test(`a loaded ${complete ? 'completed' : 'unfinished'} reading can reopen topic selections`, async () => {
    const sub = sample();
    if (!complete) sub.q = {};
    const a = app({ reply: params => params.get('action') === 'counts'
      ? { ok: true, counts: {}, questions: {} }
      : { ok: true, row: sub, rev: 'test-revision' } });
    a.t.set({ S: sample(), pin: 'TestModel', step: 0 });
    a.t.wireForm();
    a.nodes.loadMine.listeners.click();
    for (let i = 0; i < 30 && !a.t.state().saved; i++) await Promise.resolve();

    assert.equal(a.t.state().step, 3);
    assert.equal(a.nodes.bar.hidden, complete);
    assert.match(a.nodes.view.innerHTML, /id="editTopics"[^>]*>Edit topics<\/button>/);
    a.nodes.editTopics.listeners.click();
    assert.equal(a.t.state().step, 2);
    assert.equal(a.t.state().editing, true);
    assert.deepEqual(Array.from(a.t.state().S.r), sub.r);
    assert.deepEqual(JSON.parse(a.storage['eai.me.v3']).sub.q, sub.q);
    assert.equal(a.nodes.bar.hidden, false);
  });
}

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
    reply: params => params.get('action') === 'gate'
      ? {ok:true, valid:true} : {ok:true, row:stored} });
  a.t.set({ S: sub, pin: 'TestModel' });
  a.t.wireForm();
  a.nodes.next.listeners.click();
  for(let i=0;i<20 && !a.t.state().gateOk;i++) await Promise.resolve();
  assert.equal(a.t.state().gateOk, true);
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
  assert.match(a.t.state().syncState.msg, /Could not verify this name and email/);
  assert.doesNotMatch(a.t.state().syncState.msg, /organizer|restore access/);
});

for (const variant of [
  { code: 'org:testmodel', bare: false },
  { code: 'TestModel', bare: false },
  { code: 'TestModel', bare: true }
]) {
  test(`Continue automatically loads a matching saved login without rewriting it (${variant.code}, bare=${variant.bare})`, async () => {
    const b = backend(), sub = { ...sample(), hopes: 'Saved contribution', read: { paper: 1 } };
    assert.equal(b.post({ sub, pin: variant.code, gate: 'synthetic-gate' }).ok, true);
    if (variant.bare) b.tabs.Submissions.rows[1][10] = b.tabs.Submissions.rows[1][10].slice(2);
    const before = JSON.stringify(b.tabs.Submissions.rows), actions = [];
    const a = app({ bridge: true, relay: request => {
      actions.push(request.action);
      return request.action === 'put' ? b.post(request) : b.get(request);
    } });
    // Returning users need only name and email; legacy model hashes remain unchanged.
    a.t.set({ S: a.t.normalize({ n: sub.n, e: sub.e }), pin: 'TestModel' });
    a.nodes.next.listeners.click();
    await new Promise(setImmediate);
    assert.equal(a.t.state().step, 3);
    assert.equal(a.t.state().syncState.state, 'ok');
    assert.ok(a.t.sameSubmission(a.t.state().S, sub));
    assert.equal(actions.includes('put'), false);
    assert.equal(actions.includes('gate'), false);
    assert.equal(JSON.stringify(b.tabs.Submissions.rows), before);
    assert.equal(Object.hasOwn(JSON.parse(a.storage['eai.me.v3']), 'pin'), false);
  });
}

test('Continue resumes partially saved submissions at work or topics', async () => {
  for (const [work, expectedStep] of [['', 1], ['Saved research description', 2]]) {
    const b = backend(), sub = { ...sample(), w: work, r: ['', '', ''], q: {} };
    assert.equal(b.post({ sub, pin: 'org:testmodel', gate: 'synthetic-gate' }).ok, true);
    const before = JSON.stringify(b.tabs.Submissions.rows);
    const a = app({ bridge: true, relay: request =>
      request.action === 'put' ? b.post(request) : b.get(request) });
    a.t.set({ S: a.t.normalize({ n: sub.n, e: sub.e }), pin: 'TestModel' });
    a.nodes.next.listeners.click();
    await new Promise(setImmediate);
    assert.equal(a.t.state().step, expectedStep);
    assert.equal(a.t.state().saved, false);
    assert.equal(a.t.state().syncState.state, 'ok');
    assert.equal(JSON.stringify(b.tabs.Submissions.rows), before);
  }
});

test('Continue auto-loads after a reload left only login fields on this device', async () => {
  const b = backend(), sub = sample();
  assert.equal(b.post({ sub, pin: 'org:testmodel', gate: 'synthetic-gate' }).ok, true);
  const before = JSON.stringify(b.tabs.Submissions.rows);
  const storage = localRecord({ n: sub.n, e: sub.e, a: '', r: [], q: {} }, { pin: '', saved: false, step: 0 });
  const a = app({ storage, bridge: true, relay: request =>
    request.action === 'put' ? b.post(request) : b.get(request) });
  a.t.state().S.n = sample().n;
  a.nodes.next.listeners.click();
  await new Promise(setImmediate);
  assert.equal(a.t.state().step, 3);
  assert.ok(a.t.sameSubmission(a.t.state().S, sub));
  assert.equal(JSON.stringify(b.tabs.Submissions.rows), before);
});

test('Continue switches between previously loaded accounts without mixing or rewriting their answers', async () => {
  const b = backend(), first = sample(), second = { ...sample(), e: 'second@example.invalid',
    q: { T1: 'A different attendee question' } };
  for (const sub of [first, second])
    assert.equal(b.post({ sub, pin: 'org:testmodel', gate: 'synthetic-gate' }).ok, true);
  const before = JSON.stringify(b.tabs.Submissions.rows);
  let writes = 0;
  const a = app({ bridge: true, relay: request => {
    if (request.action === 'put') { writes++; return b.post(request); }
    return b.get(request);
  } });
  for (const sub of [first, second, first]) {
    a.t.state().S.e = sub.e; a.t.state().S.n = sub.n;
    a.t.set({ pin: 'TestModel', step: 0 }); a.t.wireForm();
    a.nodes.next.listeners.click();
    await new Promise(setImmediate);
    assert.equal(a.t.state().step, 3);
    assert.ok(a.t.sameSubmission(a.t.state().S, sub));
  }
  assert.equal(writes, 0);
  assert.equal(JSON.stringify(b.tabs.Submissions.rows), before);
});

test('Continue still requires registration details when the authenticated lookup finds no row', async () => {
  const b = backend(), actions = [];
  const a = app({ bridge: true, relay: request => {
    actions.push(request.action);
    return request.action === 'put' ? b.post(request) : b.get(request);
  } });
  a.t.set({ S: a.t.normalize({ n: sample().n, e: sample().e }), pin: 'TestModel' });
  a.nodes.next.listeners.click();
  await new Promise(setImmediate);
  assert.equal(a.t.state().step, 0);
  assert.match(a.nodes.view.innerHTML, /Enter the passcode from your invitation/);
  assert.doesNotMatch(a.nodes.view.innerHTML, /We need a name/);
  assert.match(a.nodes.view.innerHTML, /Where are you coming from/);
  assert.deepEqual(actions, ['get']);
  assert.equal(b.tabs.Submissions.rows.length, 1);
});

test('Continue does not replace or upload an older local draft whose saved revision is unknown', async () => {
  const b = backend(), local = sample(); local.q.T1 = 'An unsent local question';
  assert.equal(b.post({ sub: sample(), pin: 'org:testmodel', gate: 'synthetic-gate' }).ok, true);
  const before = JSON.stringify(b.tabs.Submissions.rows);
  const a = app({ storage: localRecord(local, { pin: '', step: 0 }), bridge: true,
    relay: request => request.action === 'put' ? b.post(request) : b.get(request) });
  a.t.state().S.n = sample().n;
  a.nodes.next.listeners.click();
  await new Promise(setImmediate);
  assert.equal(a.t.state().step, 0);
  assert.match(a.nodes.view.innerHTML, /Your draft is preserved/);
  assert.equal(a.t.state().S.q.T1, local.q.T1);
  assert.equal(JSON.stringify(b.tabs.Submissions.rows), before);
});

test('a late Continue lookup cannot replace edits after leaving details', async () => {
  let finishLookup;
  const a = app({ bridge: true, relay: () => new Promise(resolve => { finishLookup = resolve; }) });
  a.t.set({ S: sample(), pin: 'TestModel', saved: true });
  a.nodes.next.listeners.click();
  await new Promise(setImmediate);
  a.t.set({ step: 4 }); a.t.state().S.q.T1 = 'A question edited after leaving details';
  finishLookup({ ok: true, row: sample(), rev: 'remote-revision' });
  await new Promise(setImmediate);
  assert.equal(a.t.state().step, 4);
  assert.equal(a.t.state().S.q.T1, 'A question edited after leaving details');
  assert.equal(a.requests.length, 1);
});

test('Continue verifies a returning attendee before advancing beyond their details', async () => {
  const b = backend();
  assert.equal(b.post({ sub: sample(), pin: 'org:testmodel', gate: 'synthetic-gate' }).ok, true);
  let writes = 0;
  const a = app({ bridge: true, relay: request => {
    if (request.action === 'put') { writes++; return b.post(request); }
    return b.get(request);
  } });
  a.t.set({ S: { ...sample(), n: 'Wrong attendee' }, pin: '' });
  a.nodes.fgate.value = 'synthetic-gate';
  a.nodes.fgate.listeners.input();
  a.nodes.next.listeners.click();
  await new Promise(setImmediate);
  assert.equal(a.t.state().step, 0);
  assert.match(a.nodes.view.innerHTML, /name and email you originally submitted/);
  assert.equal(writes, 0);
  assert.equal(a.t.state().S.q.T1, sample().q.T1);
});

test('correcting access from the questions page saves the preserved draft and returns there', async () => {
  const b = backend(), draft = sample(); draft.q.T1 = 'My question typed before the access error';
  assert.equal(b.post({ sub: sample(), pin: 'org:testmodel', gate: 'synthetic-gate' }).ok, true);
  const a = app({ bridge: true, relay: request =>
    request.action === 'put' ? b.post(request) : b.get(request) });
  a.t.set({ S: { ...draft, n: 'Wrong attendee' }, pin: '', saved: true, step: 4 });
  await a.t.saveDraftNow();
  assert.equal(a.t.state().syncState.code, 'bad_pin');
  assert.doesNotMatch(a.t.state().syncState.msg, /organizer|restore access/);
  a.nodes.checkAccess.onclick();
  assert.equal(a.t.state().step, 0);
  assert.equal(a.t.state().S.q.T1, draft.q.T1);
  a.t.state().S.n = sample().n;
  a.nodes.next.listeners.click();
  await new Promise(setImmediate);
  assert.equal(a.t.state().step, 4);
  assert.equal(a.t.state().syncState.state, 'ok');
  assert.equal(b.get({ action: 'get', email: draft.e, pin: 'org:testmodel' }).row.q.T1, draft.q.T1);
  assert.equal(Object.hasOwn(JSON.parse(a.storage['eai.me.v3']), 'pin'), false);
});

test('Continue retries a previous access rejection with unchanged credentials and preserves other submissions', async () => {
  const b = backend(), sub = sample();
  for (let i = 0; i < 50; i++) {
    const other = { ...sample(), e: `existing-${i}@example.invalid`,
      hopes: `Existing contribution ${i}`, moreWork: `Existing research ${i}` };
    assert.equal(b.post({ sub: other, pin: i % 2 ? 'LegacyModel' : 'org:currentmodel',
      gate: 'synthetic-gate' }).ok, true);
  }
  const othersBefore = JSON.stringify(b.tabs.Submissions.rows);
  assert.equal(b.post({ sub, pin: 'org:testmodel', gate: 'synthetic-gate' }).ok, true);
  const keyBefore = b.tabs.Submissions.rows[51][10];
  let rejectReads = true;
  const a = app({ bridge: true, relay: request => request.action === 'put'
    ? b.post(request) : rejectReads && request.action === 'get'
      ? { ok: false, error: 'bad_pin' } : b.get(request) });
  const draft = { ...sub, q: { ...sub.q, T1: 'The local question must survive recovery' } };
  a.t.set({ S: draft, pin: 'TestModel', saved: true, step: 4 });
  await a.t.saveDraftNow();
  assert.equal(a.t.state().syncState.code, 'bad_pin');
  rejectReads = false;
  a.nodes.checkAccess.onclick();
  // Do not change the email or model: Continue itself must clear the old block.
  a.nodes.next.listeners.click();
  await new Promise(setImmediate);
  assert.equal(a.t.state().step, 4);
  assert.equal(a.t.state().syncState.state, 'ok');
  assert.equal(b.get({ action: 'get', email: sub.e, pin: 'org:testmodel' }).row.q.T1, draft.q.T1);
  assert.equal(b.tabs.Submissions.rows.length, 52);
  assert.equal(b.tabs.Submissions.rows[51][10], keyBefore);
  assert.equal(JSON.stringify(b.tabs.Submissions.rows.slice(0, 51)), othersBefore);
});

test('reloading an older local draft preserves unsent answers when the sheet only has initial details', async () => {
  const b = backend(), initial = { ...sample(), r: ['', '', ''], q: {} };
  assert.equal(b.post({ sub: initial, pin: 'org:testmodel', gate: 'synthetic-gate' }).ok, true);
  const keyBefore = b.tabs.Submissions.rows[1][10];
  const recorded = b.get({ action: 'get', email: initial.e, pin: 'org:testmodel' });
  const draft = sample();
  const storage = { 'eai.me.v3': JSON.stringify({ sub: draft, saved: true, step: 4, rev: recorded.rev }) };
  const a = app({ storage, bridge: true, relay: request =>
    request.action === 'put' ? b.post(request) : b.get(request) });
  assert.equal(a.t.state().step, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(a.t.state().S.q)), draft.q);
  a.t.state().S.n = sample().n;
  await a.t.saveDraftNow();
  assert.equal(a.t.state().syncState.state, 'ok');
  const restored = b.get({ action: 'get', email: initial.e, pin: 'org:testmodel' }).row;
  assert.deepEqual(restored.q, draft.q);
  assert.deepEqual(restored.r, draft.r);
  assert.equal(b.tabs.Submissions.rows[1][10], keyBefore);
  assert.equal(b.tabs.Submissions.rows.length, 2);
});

test('loading current and legacy submissions never rewrites their rows or stored access keys', async () => {
  const b = backend();
  const variants = [
    { code: 'org:testmodel', bare: false },
    { code: 'TestModel', bare: false },
    { code: 'TestModel', bare: true }
  ];
  for (const [i, variant] of variants.entries()) {
    const sub = { ...sample(), e: `stored-${i}@example.invalid` };
    assert.equal(b.post({ sub, pin: variant.code, gate: 'synthetic-gate' }).ok, true);
    if (variant.bare) b.tabs.Submissions.rows[i + 1][10] = b.tabs.Submissions.rows[i + 1][10].slice(2);
  }
  const before = JSON.stringify(b.tabs.Submissions.rows);
  let writes = 0;
  for (const [i, variant] of variants.entries()) {
    const a = app({ bridge: true, relay: request => {
      if (request.action === 'put') { writes++; return b.post(request); }
      return b.get(request);
    } });
    a.t.set({ S: { ...sample(), e: `stored-${i}@example.invalid` }, pin: 'TestModel' });
    a.nodes.loadMine.listeners.click();
    await new Promise(setImmediate);
    assert.equal(a.t.state().syncState.state, 'ok', variant.code);
    assert.equal(a.t.state().S.q.T1, sample().q.T1);
  }
  assert.equal(writes, 0);
  assert.equal(JSON.stringify(b.tabs.Submissions.rows), before);
});

test('Continue waits for a slow access check and ignores credentials changed during it', async () => {
  let finishLookup;
  const a = app({ bridge: true, relay: request => request.action === 'gate'
    ? { ok: true, valid: true } : new Promise(resolve => { finishLookup = resolve; }) });
  a.t.set({ S: sample(), pin: 'TestModel' });
  a.nodes.fgate.value = 'synthetic-gate';
  a.nodes.fgate.listeners.input();
  a.nodes.next.listeners.click();
  await new Promise(setImmediate);
  assert.equal(a.t.state().step, 0);
  assert.equal(a.nodes.next.disabled, true);
  a.t.state().S.n = 'Changed attendee name';
  finishLookup({ ok: true, row: sample(), rev: 'test-revision' });
  await new Promise(setImmediate);
  assert.equal(a.t.state().step, 0);
  assert.equal(a.nodes.next.disabled, false);
  assert.match(a.nodes.view.innerHTML, /access details changed while checking/);
});

test('a slow reading lookup cannot accept a name changed while it was running', async () => {
  let finishLookup;
  const a = app({ bridge: true, relay: () => new Promise(resolve => { finishLookup = resolve; }) });
  a.t.set({ S: sample(), pin: 'TestModel' });
  a.nodes.loadMine.listeners.click();
  await new Promise(setImmediate);
  a.t.state().S.n = 'Changed attendee name';
  finishLookup({ ok: true, row: sample(), rev: 'test-revision' });
  await new Promise(setImmediate);
  assert.equal(a.t.state().step, 0);
  assert.equal(a.t.state().saved, false);
  assert.notEqual(a.t.state().syncState.state, 'ok');
});

test('a slow load cannot replace questions edited after leaving the details page', async () => {
  let finishLookup;
  const a = app({ bridge: true, relay: () => new Promise(resolve => { finishLookup = resolve; }) });
  a.t.set({ S: sample(), pin: 'TestModel', saved: true });
  a.nodes.loadMine.listeners.click();
  await new Promise(setImmediate);
  a.nodes.homeBtn.listeners.click();
  a.nodes.editMine.listeners.click();
  a.t.state().S.q.T1 = 'A newer question while the earlier load was pending';
  finishLookup({ ok: true, row: sample(), rev: 'test-revision' });
  await new Promise(setImmediate);
  assert.equal(a.t.state().step, 4);
  assert.equal(a.t.state().S.q.T1, 'A newer question while the earlier load was pending');
});

test('a failed lookup does not retry an old code against a newly entered email', async () => {
  let rejectLookup, attempts = 0;
  const a = app();
  a.t.set({ S: sample(), pin: 'TestModel' });
  const lookup = a.t.withKey(() => {
    attempts++;
    if (attempts > 1) return Promise.reject({ code: 'bad_pin' });
    return new Promise((resolve, reject) => { rejectLookup = reject; });
  });
  a.t.set({ S: { ...sample(), e: 'different@example.invalid' } });
  const rejected = assert.rejects(lookup, error => error.code === 'identity_changed');
  rejectLookup({ code: 'bad_pin' });
  await rejected;
  assert.equal(attempts, 1);
});

test('a verified legacy code remains usable during simultaneous reading requests', async () => {
  const b = backend();
  assert.equal(b.post({ sub: sample(), pin: 'TestModel', gate: 'synthetic-gate' }).ok, true);
  const a = app(); a.t.set({ S: sample(), pin: 'TestModel' });
  const authenticate = () => a.t.withKey(code => {
    const result = b.get({ action: 'get', email: sample().e, pin: code });
    return result.ok ? Promise.resolve(result) : Promise.reject({ code: result.error });
  });
  assert.equal((await authenticate()).ok, true);
  const results = await Promise.allSettled(Array.from({ length: 8 }, authenticate));
  assert.ok(results.every(result => result.status === 'fulfilled'));
  assert.ok(!b.c.locked_(sample().e));
});

test('re-entering a code after reload cannot overwrite a newer sheet revision', async () => {
  const b = backend(), local = sample(); local.q.T1 = 'A local unsaved question';
  assert.equal(b.post({ sub: sample(), pin: 'org:testmodel', gate: 'synthetic-gate' }).ok, true);
  const original = b.get({ action: 'get', email: sample().e, pin: 'org:testmodel' });
  const storage = { 'eai.me.v3': JSON.stringify({ sub: local, saved: true, step: 0, rev: original.rev }) };
  const remote = sample(); remote.q.T1 = 'A newer question on another device';
  assert.equal(b.post({ sub: remote, pin: 'org:testmodel', ifMatch: original.rev }).ok, true);
  const a = app({ storage, bridge: true, relay: request =>
    request.action === 'put' ? b.post(request) : b.get(request) });
  assert.equal(a.t.state().pin, '');
  a.t.state().S.n = sample().n;
  a.nodes.next.listeners.click();
  await new Promise(setImmediate);
  assert.equal(a.t.state().step, 0);
  assert.equal(a.t.state().S.q.T1, local.q.T1);
  assert.equal(b.get({ action: 'get', email: sample().e, pin: 'org:testmodel' }).row.q.T1, remote.q.T1);
});

for (const storedKey of [null, 'org:testmodel', 'TestModel']) {
  test(`details through questions save against the real backend (${storedKey || 'new attendee'})`, async () => {
    const b = backend();
    if (storedKey) assert.equal(b.post({ sub: sample(), pin: storedKey, gate: 'synthetic-gate' }).ok, true);
    const a = app({ bridge: true, relay: request =>
      request.action === 'put' ? b.post(request) : b.get(request) });
    a.t.set({ S: { ...sample(), r: ['', '', ''], q: {}, w: '' }, pin: 'TestModel' });
    a.nodes.fgate.value = 'synthetic-gate';
    a.nodes.fgate.listeners.input();
    a.nodes.next.listeners.click();
    await new Promise(setImmediate);
    if (storedKey) {
      assert.equal(a.t.state().step, 3); // matching login automatically resumes
      a.t.set({ step: 1 }); a.t.wireForm();
    }
    assert.equal(a.t.state().step, 1);
    a.t.state().S.w = 'Research on AI and evolution';
    a.t.state().S.hopes = 'Compare approaches and share research';
    a.nodes.next.listeners.click();
    await new Promise(setImmediate);
    assert.equal(a.t.state().step, 2);
    a.t.state().S.r = ['T1', 'T2', 'T3'];
    a.nodes.next.listeners.click();
    await new Promise(setImmediate);
    assert.equal(a.t.state().step, 3);
    a.nodes.next.listeners.click();
    await new Promise(setImmediate);
    assert.equal(a.t.state().step, 4);
    assert.equal(a.t.state().syncState.state, 'ok');
    const restored = b.get({ action: 'get', email: sample().e, pin: storedKey || 'name:test attendee' });
    assert.equal(restored.ok, true);
    assert.deepEqual(restored.row.r, ['T1', 'T2', 'T3']);
    assert.equal(restored.row.hopes, 'Compare approaches and share research');
  });
}

for (const code of ['org:testmodel', 'TestModel']) {
  test(`loaded reading can change topics and save new questions with ${code}`, async () => {
    const b = backend(), sub = sample(); sub.q = {};
    assert.equal(b.post({ sub, pin: code, gate: 'synthetic-gate' }).ok, true);
    const a = app({ bridge: true, relay: request =>
      request.action === 'put' ? b.post(request) : b.get(request) });
    a.t.set({ S: sample(), pin: 'TestModel' });
    a.nodes.loadMine.listeners.click();
    await new Promise(setImmediate);
    assert.equal(a.t.state().step, 3);
    a.nodes.editTopics.listeners.click();
    a.t.state().S.r = ['T1', 'T2', 'T4'];
    a.nodes.next.listeners.click();
    await new Promise(setImmediate);
    a.nodes.next.listeners.click();
    a.t.state().S.q.T4 = 'What should our new group investigate?';
    a.t.queueDraftSave();
    await new Promise(setImmediate);
    assert.equal(a.t.state().step, 4);
    assert.equal(a.t.state().syncState.state, 'ok');
    const row = b.get({ action: 'get', email: sub.e, pin: code }).row;
    assert.deepEqual(row.r, ['T1', 'T2', 'T4']);
    assert.equal(row.q.T4, a.t.state().S.q.T4);
  });
}


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

test('copied roster cannot create spreadsheet formulas or extra cells', () => {
  const a = app();
  a.t.setRoster([{ ...sample(), n: '\t=HYPERLINK("https://example.invalid")',
    a: '+1+1', w: 'Research\n=2+2', c: '@SUM(1)',
    q: { T1: '=3+3', T2: 'A question\t=4+4', T3: 'Ordinary question' },
    hopes: '-5+5', moreWork: '\r@SUM(6)' }]);
  const lines = a.t.rosterTsv().split('\n');
  assert.equal(lines.length, 2);
  const cells = lines[1].split('\t');
  assert.equal(cells.length, 16);
  assert.equal(cells[0], "'=HYPERLINK(\"https://example.invalid\")");
  assert.equal(cells[2], "'+1+1");
  assert.equal(cells[3], 'Research =2+2');
  assert.equal(cells[4], "'@SUM(1)");
  assert.equal(cells[8], "'=3+3");
  assert.equal(cells[9], 'A question =4+4');
  assert.equal(cells[12], "'-5+5");
  assert.equal(cells[13], "'@SUM(6)");
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
  test(`${entry === 'next' ? 'Write my questions' : 'Edit questions'} then Back preserves the full reading page after reload`, () => {
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

test('a committed save with a lost confirmation recovers after reload without losing later edits', async () => {
  const b = backend(), initial = sample();
  b.post({ action: 'put', sub: initial, pin: 'org:testmodel', gate: 'synthetic-gate' });
  const record = b.get({ action: 'get', email: initial.e, pin: 'org:testmodel' });
  const storage = localRecord(initial, { rev: record.rev });
  let failConfirmation = false;
  const a = app({ bridge: true, storage, relay: req => {
    if (req.action === 'put') { const result = b.post(req); failConfirmation = true; return result; }
    if (req.action === 'get' && failConfirmation) return { ok: false, error: 'backend_error' };
    return b.get(req);
  } });
  const first = sample(); first.q.T1 = 'My first saved edit';
  a.t.set({ S: first });
  await a.t.saveDraftNow();
  assert.equal(b.get({ action: 'get', email: initial.e, pin: 'org:testmodel' }).row.q.T1, first.q.T1);
  const newer = sample(); newer.q.T1 = 'My next unsent edit';
  a.t.set({ S: newer }); a.t.saveLocal();
  const reloaded = app({ bridge: true, storage, relay: req => req.action === 'put' ? b.post(req) : b.get(req) });
  reloaded.t.set({ pin: 'TestModel' });
  await reloaded.t.saveDraftNow();
  assert.equal(reloaded.t.state().syncState.state, 'ok');
  assert.equal(b.get({ action: 'get', email: initial.e, pin: 'org:testmodel' }).row.q.T1, newer.q.T1);
});

function savedBackend(initial = sample()) {
  const b = backend();
  b.post({ action: 'put', sub: initial, pin: 'org:testmodel', gate: 'synthetic-gate' });
  const record = b.get({ action: 'get', email: initial.e, pin: 'org:testmodel' });
  return { b, record, relay: req => req.action === 'put' ? b.post(req) : b.get(req) };
}

test('concurrent changes to separate questions merge against the persisted saved base', async () => {
  const initial = sample(), { b, record, relay } = savedBackend(initial);
  const local = sample(); local.q.T1 = 'Unsent local question'; delete local.read.paper;
  const remote = sample(); remote.q.T2 = 'New question from the other browser'; remote.hopes = 'A remote contribution';
  b.post({ action: 'put', sub: remote, pin: 'org:testmodel', ifMatch: record.rev });
  const a = app({ bridge: true, storage: localRecord(local, { rev: record.rev, base: { sub: initial, rev: record.rev } }), relay });
  await a.t.saveDraftNow();
  const saved = b.get({ action: 'get', email: local.e, pin: 'org:testmodel' }).row;
  assert.equal(a.t.state().syncState.state, 'ok');
  assert.equal(saved.q.T1, local.q.T1); assert.equal(saved.q.T2, remote.q.T2);
  assert.equal(saved.hopes, remote.hopes); assert.equal(a.t.state().S.q.T2, remote.q.T2);
});

test('a cleared local field stays cleared while unrelated remote changes merge', async () => {
  const initial = { ...sample(), read: { paper: 1 } }, { b, record, relay } = savedBackend(initial);
  const local = { ...initial, w: '', read: {} }, remote = { ...initial, hopes: 'Remote hopes' };
  b.post({ action: 'put', sub: remote, pin: 'org:testmodel', ifMatch: record.rev });
  const a = app({ bridge: true, storage: localRecord(local, { pin: '', rev: record.rev, base: { sub: initial, rev: record.rev } }), relay });
  a.t.set({ pin: 'TestModel' });
  await a.t.saveDraftNow();
  const saved = b.get({ action: 'get', email: local.e, pin: 'org:testmodel' }).row;
  assert.equal(saved.w, ''); assert.deepEqual(saved.read, {}); assert.equal(saved.hopes, remote.hopes);
});

for (const useSheet of [false, true]) {
  test(`Load my reading preserves an old unsent draft and review can save the ${useSheet ? 'sheet' : 'device'} answer`, async () => {
    const { b, record, relay } = savedBackend();
    const local = sample(); local.q.T1 = 'Local-only answer that must survive';
    const storage = localRecord(local, { pin: '', rev: 'older-revision', step: 0 });
    const a = app({ bridge: true, storage, relay });
    a.t.state().S.n = sample().n;
    const before = JSON.stringify(b.tabs.Submissions.rows);
    a.nodes.loadMine.listeners.click();
    await new Promise(setImmediate);
    assert.equal(a.t.state().S.q.T1, local.q.T1);
    assert.equal(JSON.stringify(b.tabs.Submissions.rows), before);
    assert.match(a.nodes.view.innerHTML, /Review your answers/);
    assert.match(a.nodes.view.innerHTML, /Local-only answer that must survive/);
    assert.doesNotMatch(a.nodes.view.innerHTML, /Question: undefined/);
    a.nodes[useSheet ? 'resolveSheet' : 'resolveDevice'].onclick();
    await new Promise(setImmediate);
    const saved = b.get({ action: 'get', email: local.e, pin: 'org:testmodel' }).row;
    assert.equal(saved.q.T1, useSheet ? sample().q.T1 : local.q.T1);
    assert.equal(a.t.state().syncState.state, 'ok');
    assert.equal(JSON.parse(storage['eai.recovery.v1']).device.q.T1, local.q.T1);
    assert.equal(JSON.parse(storage['eai.recovery.v1']).sheet.q.T1, sample().q.T1);
  });
}

test('review keeps unrelated remote edits when the attendee selects their local conflicting answer', async () => {
  const initial = sample(), { b, record, relay } = savedBackend(initial);
  const local = sample(); local.q.T1 = 'Local answer';
  const remote = sample(); remote.q.T1 = 'Conflicting remote answer'; remote.q.T2 = 'Unrelated remote answer';
  b.post({ action: 'put', sub: remote, pin: 'org:testmodel', ifMatch: record.rev });
  const a = app({ bridge: true, storage: localRecord(local, { rev: record.rev, base: { sub: initial, rev: record.rev } }), relay });
  await a.t.saveDraftNow();
  assert.equal(a.t.state().syncState.code, 'conflict');
  a.nodes.resolveDevice.onclick(); await new Promise(setImmediate);
  const saved = b.get({ action: 'get', email: local.e, pin: 'org:testmodel' }).row;
  assert.equal(saved.q.T1, local.q.T1); assert.equal(saved.q.T2, remote.q.T2);
});

test('a row changed again during conflict review is protected and requires another review', async () => {
  const { b, relay } = savedBackend();
  const local = sample(); local.q.T1 = 'Unsent device answer';
  const a = app({ bridge: true, storage: localRecord(local, { rev: 'old-revision' }), relay });
  await a.t.saveDraftNow();
  const latest = sample(); latest.q.T1 = 'Changed again during review';
  b.post({ action: 'put', sub: latest, pin: 'org:testmodel' });
  const before = JSON.stringify(b.tabs.Submissions.rows);
  a.nodes.resolveDevice.onclick(); await new Promise(setImmediate);
  assert.equal(a.t.state().syncState.code, 'conflict');
  assert.equal(JSON.stringify(b.tabs.Submissions.rows), before);
  assert.equal(a.t.state().S.q.T1, local.q.T1);
  assert.match(a.nodes.readingSync.innerHTML, /Changed again during review/);
});

test('review refreshes if the local draft changed before a resolution button was clicked', async () => {
  const { b, relay } = savedBackend();
  const local = sample(); local.q.T1 = 'Original local answer';
  const a = app({ bridge: true, storage: localRecord(local, { rev: 'old-revision' }), relay });
  await a.t.saveDraftNow();
  const before = JSON.stringify(b.tabs.Submissions.rows);
  a.t.state().S.q.T1 = 'Newer local answer during review';
  a.nodes.resolveDevice.onclick(); await new Promise(setImmediate);
  assert.equal(JSON.stringify(b.tabs.Submissions.rows), before);
  assert.equal(a.t.state().S.q.T1, 'Newer local answer during review');
  assert.match(a.nodes.view.innerHTML, /Newer local answer during review/);
  a.nodes.resolveDevice.onclick(); await new Promise(setImmediate);
  assert.equal(b.get({ action: 'get', email: local.e, pin: 'org:testmodel' }).row.q.T1, 'Newer local answer during review');
});

test('changing topic selections on one device and questions on another requires review', async () => {
  const initial = sample(), { b, record, relay } = savedBackend(initial);
  const local = sample(); local.q.T1 = 'Local question';
  const remote = sample(); remote.r = ['T4', 'T5', 'T6']; remote.q = { T4: 'Remote question' };
  b.post({ action: 'put', sub: remote, pin: 'org:testmodel', ifMatch: record.rev });
  const before = JSON.stringify(b.tabs.Submissions.rows);
  const a = app({ bridge: true, storage: localRecord(local, { rev: record.rev, base: { sub: initial, rev: record.rev } }), relay });
  await a.t.saveDraftNow();
  assert.equal(a.t.state().syncState.code, 'conflict');
  assert.equal(JSON.stringify(b.tabs.Submissions.rows), before);
  assert.match(a.nodes.readingSync.innerHTML, /Topic choices and questions/);
});

test('a known unsent draft survives loading a reading even when its Sheet revision is current', async () => {
  const { b, record, relay } = savedBackend();
  const local = sample(); local.q.T1 = 'Not yet submitted';
  const a = app({ bridge: true, storage: localRecord(local, { rev: record.rev, step: 0 }), relay });
  a.nodes.loadMine.listeners.click(); await new Promise(setImmediate);
  assert.equal(a.t.state().S.q.T1, local.q.T1);
  assert.equal(a.t.state().step, 3);
  assert.equal(a.t.state().syncState.state, 'local');
  assert.equal(b.get({ action: 'get', email: local.e, pin: 'org:testmodel' }).row.q.T1, sample().q.T1);
  await a.t.saveDraftNow();
  assert.equal(a.t.state().syncState.state, 'ok');
});

test('Load my reading restores a name-and-email login retained from a previous reload', async () => {
  const { b, relay } = savedBackend();
  const a = app({ bridge: true, storage: localRecord({ n: sample().n, e: sample().e }, { saved: false, step: 0 }), relay });
  const before = JSON.stringify(b.tabs.Submissions.rows);
  a.nodes.loadMine.listeners.click(); await new Promise(setImmediate);
  assert.equal(a.t.state().step, 3);
  assert.equal(a.t.state().syncState.state, 'ok');
  assert.ok(a.t.sameSubmission(a.t.state().S, sample()));
  assert.equal(JSON.stringify(b.tabs.Submissions.rows), before);
});

test('1-on-1 dropdown lists all participants and selects only listed people, saves to the Sheet, and restores on another device', async () => {
  const b=backend(), self=sample(), other={...sample(),e:'other@example.invalid',n:'Research Partner',a:'Institute of Cooperation'};
  for(const s of [self,other]) assert.equal(b.post({action:'put',sub:s,pin:'org:testmodel',gate:'synthetic-gate'}).ok,true);
  const a=app({bridge:true,relay:req=>req.action==='put'?b.post(req):b.get(req)});
  a.t.set({S:self,pin:'TestModel',step:3}); a.t.wireForm(); await new Promise(setImmediate);
  assert.match(a.t.participantOptions(),/Research Partner: Institute of Cooperation/);
  assert.doesNotMatch(a.t.participantOptions(),/Test Attendee/);
  assert.doesNotMatch(a.t.renderOneOnOne(),/participantSearch|Search participants/);
  assert.equal(a.t.validate(3),true);
  const pick=b.get({action:'participants',email:self.e,pin:'org:testmodel'}).participants[0];
  a.nodes.oneOnOne.value=pick.id; a.nodes.oneOnOne.listeners.change();
  assert.equal(a.t.validate(3),true);
  await a.t.saveDraftNow();
  assert.equal(a.t.state().syncState.state,'ok');
  const record=b.get({action:'get',email:self.e,pin:'org:testmodel'});
  assert.deepEqual(record.row.oneOnOne,pick);
  const restored=app({storage:localRecord(record.row)});
  assert.equal(restored.t.state().S.oneOnOne.id,pick.id);
  assert.match(restored.t.renderReading(),/Research Partner: Institute of Cooperation/);
  a.t.setRoster([record.row]); assert.match(a.t.rosterTsv(),/Research Partner: Institute of Cooperation/);
});

test('the seminar heading and progress precede the full dropdown, which saves without an extra page', async () => {
  const b=backend(), self=sample();
  b.post({action:'put',sub:self,pin:'org:testmodel',gate:'synthetic-gate'});
  for(const [i,name] of ['Alex','Blair'].entries())
    b.post({action:'put',sub:{...self,e:'partner'+i+'@example.invalid',n:name,a:'Researcher, Institute '+i},pin:'org:testmodel',gate:'synthetic-gate'});
  const a=app({bridge:true,relay:req=>req.action==='put'?b.post(req):b.get(req)});
  a.t.set({S:self,pin:'TestModel',step:2});a.t.wireForm();
  a.nodes.next.listeners.click();await new Promise(setImmediate);
  assert.equal(a.t.state().step,3);
  const reading=a.nodes.view.innerHTML;
  assert.ok(reading.indexOf('<div class="head thin">') < reading.indexOf('id="readingProgress"'));
  assert.ok(reading.indexOf('id="readingProgress"') < reading.indexOf('id="oneOnOnePanel"'));
  assert.ok(reading.indexOf('id="oneOnOnePanel"') < reading.indexOf('class="topicblock common"'));
  assert.match(a.t.renderOneOnOne(),/Alex: Researcher, Institute 0/);
  assert.match(a.t.renderOneOnOne(),/Blair: Researcher, Institute 1/);
  assert.match(reading,/Who would you like to meet\? The organizers will use everyone’s preferences to arrange pairs\./);
  assert.doesNotMatch(reading,/participantSearch|Search participants|Your preferred person|editOneOnOne|1-on-1 preference:/);
  assert.match(reading,/aria-labelledby="oneOnOneHeading"/);
  const pick=b.get({action:'participants',email:self.e,pin:'org:testmodel'}).participants[0];
  a.nodes.oneOnOne.value=pick.id;a.nodes.oneOnOne.listeners.change();
  await new Promise(setImmediate);
  assert.equal(b.get({action:'get',email:self.e,pin:'org:testmodel'}).row.oneOnOne.id,pick.id);
  assert.equal(a.t.state().step,3);
  a.nodes.back.listeners.click();assert.equal(a.t.state().step,2);
});

test('returning attendees with submitted questions see the picker below progress and retain their readings and answers', async () => {
  const b=backend(), self=sample(), peer={...sample(),e:'peer@example.invalid',n:'Peer'};
  self.read.paper=1;
  for(const sub of [self,peer]) b.post({action:'put',sub,pin:'org:testmodel',gate:'synthetic-gate'});
  const a=app({bridge:true,relay:req=>req.action==='put'?b.post(req):b.get(req)});
  a.t.set({S:self,pin:'TestModel'});a.nodes.loadMine.listeners.click();await new Promise(setImmediate);
  assert.equal(a.t.state().step,3);
  assert.ok(a.nodes.view.innerHTML.indexOf('id="readingProgress"') < a.nodes.view.innerHTML.indexOf('oneOnOneHeading'));
  const pick=b.get({action:'participants',email:self.e,pin:'org:testmodel'}).participants[0];
  a.nodes.oneOnOne.value=pick.id;a.nodes.oneOnOne.listeners.change();await new Promise(setImmediate);
  const row=b.get({action:'get',email:self.e,pin:'org:testmodel'}).row;
  assert.equal(row.oneOnOne.id,pick.id);
  assert.deepEqual(row.q,self.q);assert.deepEqual(row.read,self.read);
});

test('saved drafts on the old 1-on-1 step resume on readings with their preference preserved', () => {
  const sub={...sample(),oneOnOne:{id:'a'.repeat(43),name:'Peer',affiliation:'Institute'}};
  const a=app({storage:localRecord(sub,{step:5})});
  assert.equal(a.t.state().step,3);
  assert.equal(a.t.state().S.oneOnOne.id,sub.oneOnOne.id);
  assert.match(a.nodes.view.innerHTML,/oneOnOneHeading/);
});

test('1-on-1 directory failures leave readings accessible and preserve the saved choice for retry', async () => {
  const s={...sample(),oneOnOne:{id:'a'.repeat(43),name:'Saved choice',affiliation:'Institute'}};
  const a=app({bridge:true,reply:()=>({ok:false,error:'backend_error'})});
  a.t.set({S:s,pin:'TestModel',step:3});a.t.wireForm();await new Promise(setImmediate);
  assert.match(a.t.renderOneOnOne(),/Try loading participants again/);
  assert.equal(a.t.validate(3),true);
  assert.equal(a.t.state().S.oneOnOne.name,'Saved choice');
});

test('an empty synthetic directory allows access to readings without inventing a partner', async () => {
  const a=app({bridge:true,reply:()=>({ok:true,participants:[]})});
  a.t.set({S:sample(),pin:'TestModel',step:3});a.t.wireForm();await new Promise(setImmediate);
  assert.equal(a.t.validate(3),true);
  assert.match(a.t.renderOneOnOne(),/No other participants are listed yet/);
});

test('simultaneous 1-on-1 edits require conflict review while independent answers merge', () => {
  const base={...sample(),oneOnOne:null};
  const local={...base,oneOnOne:{id:'a'.repeat(43),name:'Alice',affiliation:'Institute A'}};
  const remote={...base,oneOnOne:{id:'b'.repeat(43),name:'Bob',affiliation:'Institute B'},hopes:'New contribution'};
  const a=app(), merged=a.t.mergeDraft(local,base,remote);
  assert.equal(merged.conflicts.length,1);assert.equal(merged.conflicts[0].path,'oneOnOne');
  assert.equal(merged.sub.hopes,'New contribution');
});

test('directory description corrections confirm saves without changing the selected person', async () => {
  const b=backend(), self=sample(), other={...sample(),e:'other@example.invalid',n:'Research Partner',a:'Correct Institute'};
  for(const s of [self,other]) b.post({action:'put',sub:s,pin:'org:testmodel',gate:'synthetic-gate'});
  const pick=b.get({action:'participants',email:self.e,pin:'org:testmodel'}).participants[0];
  const local={...self,oneOnOne:{...pick,affiliation:'Old Institute'}};
  const a=app({bridge:true,relay:req=>req.action==='put'?b.post(req):b.get(req)});
  await a.t.cloudLookup(self.e,'org:testmodel');
  const saved=await a.t.cloudPush(local,'org:testmodel');
  assert.equal(saved.oneOnOne.affiliation,'Correct Institute');
  assert.equal(a.t.sameSubmission(saved,local),true);
  const merged=a.t.mergeDraft(local,self,saved);
  assert.equal(merged.conflicts.length,0);
  assert.equal(merged.sub.oneOnOne.affiliation,'Correct Institute');
  assert.equal(a.t.sameSubmission(saved,{...local,oneOnOne:{...pick,id:'b'.repeat(43)}}),false);
});


test('participant loading starts after sign-in and finishes on readings without a second request', async () => {
  const b=backend(), self={...sample(),hopes:'Share research approaches'}, peer={...sample(),e:'peer@example.invalid',n:'Research Partner'};
  b.post({action:'put',sub:peer,pin:'org:testmodel',gate:'synthetic-gate'});
  let finishParticipants;
  const a=app({bridge:true,relay:req=>{
    if(req.action==='participants') return new Promise(resolve=>{finishParticipants=()=>resolve(b.get(req));});
    return req.action==='put'?b.post(req):b.get(req);
  }});
  a.t.set({S:self,pin:'TestModel',step:2});a.t.wireForm();
  await new Promise(setImmediate);
  assert.equal(a.requests.filter(r=>JSON.parse(r.options.body).request.action==='participants').length,0);
  a.t.set({step:0});a.t.wireForm();
  a.nodes.fgate.value='synthetic-gate';a.nodes.fgate.listeners.input();
  a.nodes.next.listeners.click();await new Promise(setImmediate);
  assert.equal(a.t.state().step,1);
  assert.equal(typeof finishParticipants,'function');
  const requests=()=>a.requests.filter(r=>JSON.parse(r.options.body).request.action==='participants').length;
  assert.equal(requests(),1);
  a.nodes.next.listeners.click();await new Promise(setImmediate);
  assert.equal(a.t.state().step,2);
  a.nodes.next.listeners.click();await new Promise(setImmediate);
  assert.equal(a.t.state().step,3);assert.equal(requests(),1);
  finishParticipants();await new Promise(setImmediate);
  assert.match(a.t.renderOneOnOne(),/Research Partner/);
  assert.doesNotMatch(a.t.renderOneOnOne(),/Loading participants/);
  a.t.wireForm();await new Promise(setImmediate);assert.equal(requests(),1);
});


test('progress requires a 1-on-1 choice for completion and updates immediately when selected or cleared', () => {
  const a=app(), sub=sample();
  a.t.set({S:sub,saved:true,step:3});
  for(const reading of a.t.requiredReadings()) sub.read[reading.url]=1;
  const progress=()=>a.t.renderProgress();
  assert.match(progress(),/pgpct">80<i/);
  assert.match(progress(),/1-on-1 choice left/);
  assert.match(progress(),/data-go="one-on-one"[^]*?pgstate">Choose/);
  sub.oneOnOne={id:'a'.repeat(43),name:'Peer',affiliation:'Institute'};
  assert.match(progress(),/pgpct">100<i/);
  assert.doesNotMatch(progress(),/1-on-1 choice left/);
  assert.match(progress(),/<li class="done"><button class="pgrow" type="button" data-go="one-on-one"/);
  sub.oneOnOne=null;
  assert.match(progress(),/pgpct">80<i/);
  assert.match(progress(),/1-on-1 choice left/);
});

test('a dropdown selection saves immediately without timers or Next and newer selections during a save also reach the Sheet', async () => {
  const b=backend(), self=sample();
  for(const [i,name] of ['Test Attendee','First peer','Second peer'].entries())
    b.post({action:'put',sub:{...self,e:i ? 'peer'+i+'@example.invalid' : self.e,n:name},pin:'org:testmodel',gate:'synthetic-gate'});
  let firstSave, releaseFirst;
  const a=app({bridge:true,autoDraftTimers:false,relay:req=>{
    if(req.action==='put' && !firstSave){
      firstSave=req;
      return new Promise(resolve=>{releaseFirst=()=>resolve(b.post(req));});
    }
    return req.action==='put'?b.post(req):b.get(req);
  }});
  a.t.set({S:self,pin:'TestModel'});a.nodes.loadMine.listeners.click();await new Promise(setImmediate);
  const picks=b.get({action:'participants',email:self.e,pin:'org:testmodel'}).participants;
  a.nodes.oneOnOne.value=picks[0].id;a.nodes.oneOnOne.listeners.change();
  assert.equal(a.t.state().syncState.state,'saving');
  assert.match(a.nodes.readingProgress.innerHTML,/data-go="one-on-one"[^]*?pgstate">Done/);
  await new Promise(setImmediate);
  assert.equal(firstSave.sub.oneOnOne.id,picks[0].id,'Upload must start without advancing any debounce timer');
  a.nodes.oneOnOne.value=picks[1].id;a.nodes.oneOnOne.listeners.change();
  releaseFirst();await new Promise(setImmediate);
  assert.equal(a.t.state().step,3);
  assert.equal(a.t.state().syncState.state,'ok');
  assert.equal(b.get({action:'get',email:self.e,pin:'org:testmodel'}).row.oneOnOne.id,picks[1].id);
  assert.equal(a.requests.filter(r=>JSON.parse(r.options.body).request.action==='put').length,2);
});

test('the 1-on-1 progress item focuses the inline dropdown without changing pages', () => {
  const a=app();a.t.set({step:3});
  const button={listeners:{},getAttribute:()=> 'one-on-one',addEventListener:(event,fn)=>button.listeners[event]=fn};
  a.nodes.view.querySelectorAll=selector=>selector==='[data-go]' ? [button] : [];
  const select=a.context.document.getElementById('oneOnOne');let focused=false,scrolled=false;
  select.focus=()=>focused=true;select.scrollIntoView=()=>scrolled=true;
  a.t.wireProgress();button.listeners.click();
  assert.equal(focused,true);assert.equal(scrolled,true);assert.equal(a.t.state().step,3);
});


test('successful verification remembers access and repeated reloads restore the same account without asking for a model or writing', async () => {
  const b=backend(), sub={...sample(),oneOnOne:null};
  b.post({action:'put',sub,pin:'org:testmodel',gate:'synthetic-gate'});
  let writes=0;
  const relay=req=>{if(req.action==='put'){writes++;return b.post(req);}return b.get(req);};
  const first=app({bridge:true,relay});first.t.set({S:sub,pin:'TestModel'});
  first.nodes.loadMine.listeners.click();await new Promise(setImmediate);
  assert.deepEqual(JSON.parse(first.storage['eai.access.v1']),{email:sub.e,key:'name:test attendee'});
  assert.equal(first.storage['eai.gate.v1'],undefined);
  assert.equal(Object.hasOwn(JSON.parse(first.storage['eai.me.v3']),'pin'),false);
  const storage=first.storage;
  for(let i=0;i<3;i++){
    const returned=app({storage,bridge:true,relay});await new Promise(setImmediate);
    assert.equal(returned.t.state().step,3);
    assert.equal(returned.t.state().needsPin,false);
    assert.equal(returned.t.state().syncState.state,'ok');
    assert.deepEqual(JSON.parse(JSON.stringify(returned.t.state().S.q)),sub.q);
    assert.match(returned.nodes.view.innerHTML,/readingProgress/);
    assert.doesNotMatch(returned.nodes.view.innerHTML,/Favorite AI model/);
    assert.equal(JSON.parse(storage['eai.access.v1']).key,'name:test attendee');
    assert.equal(returned.requests.filter(r=>JSON.parse(r.options.body).request.action==='get').length,1);
    assert.ok(returned.requests.every(r=>!r.url.includes('testmodel')));
    assert.doesNotMatch(returned.t.myLink(),/testmodel|org:/);
  }
  assert.equal(writes,0,'Reopening a verified device must not rewrite existing submissions');
});

test('remembered access preserves unsaved questions, reading progress, preference, and the current editing step', async () => {
  const b=backend(), sub=sample();
  b.post({action:'put',sub,pin:'org:testmodel',gate:'synthetic-gate'});
  const relay=req=>req.action==='put'?b.post(req):b.get(req);
  const first=app({bridge:true,relay});first.t.set({S:sub,pin:'TestModel'});
  first.nodes.loadMine.listeners.click();await new Promise(setImmediate);
  first.t.state().S.q.T1='My unsent new question stays on this device';
  first.t.state().S.read.paper=1;first.t.set({step:4});first.t.saveLocal();
  const returned=app({storage:first.storage,bridge:true,relay,autoDraftTimers:false});await new Promise(setImmediate);
  assert.equal(returned.t.state().step,4);
  assert.equal(returned.t.state().S.q.T1,'My unsent new question stays on this device');
  assert.equal(returned.t.state().S.read.paper,1);
  assert.deepEqual(Array.from(returned.t.state().S.r),sub.r);
  assert.equal(b.get({action:'get',email:sub.e,pin:'org:testmodel'}).row.q.T1,sub.q.T1);
  assert.equal(JSON.parse(first.storage['eai.me.v3']).step,4);
});

test('missing or mismatched names cannot fetch saved information', async () => {
  const b = backend(), sub = sample();
  b.post({action:'put', sub, pin:'org:testmodel', gate:'synthetic-gate'});
  const before = JSON.stringify(b.tabs.Submissions.rows);
  const relay = req => req.action === 'put' ? b.post(req) : b.get(req);
  for (const name of ['', 'Wrong attendee']) {
    const a = app({bridge:true, relay});
    a.t.set({S:{...sub, n:name}, pin:''});
    a.nodes.loadMine.listeners.click(); await new Promise(setImmediate);
    assert.equal(a.t.state().step, 0);
    assert.equal(a.storage['eai.access.v1'], undefined);
    if (!name) assert.equal(a.requests.length, 0);
    else assert.ok(a.requests.length > 0);
  }
  assert.equal(JSON.stringify(b.tabs.Submissions.rows), before);
});

test('network failure retains remembered access and drafts; an explicit access rejection returns to name and email', async () => {
  const sub=sample(), storage=localRecord(sub,{pin:'',step:3});
  storage['eai.access.v1']=JSON.stringify({email:sub.e,key:'org:testmodel'});
  const offline=app({storage,bridge:true,reply:()=>({ok:false,error:'backend_error'})});await new Promise(setImmediate);
  assert.equal(JSON.parse(storage['eai.access.v1']).key,'org:testmodel');
  assert.equal(offline.t.state().S.q.T1,sub.q.T1);
  const rejected=app({storage,bridge:true,reply:()=>({ok:false,error:'bad_pin'})});await new Promise(setImmediate);
  assert.equal(storage['eai.access.v1'],undefined);
  assert.equal(rejected.t.state().needsPin,true);assert.equal(rejected.t.state().pin,'');
  assert.equal(rejected.t.state().S.q.T1,sub.q.T1);
  assert.equal(rejected.requests.filter(r=>JSON.parse(r.options.body).request.action==='get').length,1);
});

test('legacy entries resume by name and email without guessing or changing their model key', async () => {
  const b=backend(), sub=sample();b.post({action:'put',sub,pin:'LegacyModel',gate:'synthetic-gate'});
  const relay=req=>req.action==='put'?b.post(req):b.get(req);
  const a=app({bridge:true,relay});a.t.set({S:sub,pin:'LegacyModel'});
  a.nodes.loadMine.listeners.click();await new Promise(setImmediate);
  assert.equal(JSON.parse(a.storage['eai.access.v1']).key,'name:test attendee');
  const returned=app({storage:a.storage,bridge:true,relay});await new Promise(setImmediate);
  assert.equal(returned.t.state().step,3);
  assert.ok(returned.requests.every(r=>JSON.parse(r.options.body).request.pin==='name:test attendee'));
  assert.ok(!b.c.locked_(sub.e));
});


test('older devices still holding their existing personal code become remembered after verification without resetting answers', async () => {
  const b=backend(), sub=sample();b.post({action:'put',sub,pin:'org:testmodel',gate:'synthetic-gate'});
  const relay=req=>req.action==='put'?b.post(req):b.get(req);
  const storage=localRecord(sub,{step:3});
  const older=app({storage,bridge:true,relay});await new Promise(setImmediate);
  assert.equal(older.t.state().step,3);
  assert.equal(JSON.parse(storage['eai.access.v1']).key,'name:test attendee');
  const returned=app({storage,bridge:true,relay});await new Promise(setImmediate);
  assert.equal(returned.t.state().step,3);assert.equal(returned.t.state().needsPin,false);
  assert.equal(returned.t.state().S.q.T1,sub.q.T1);
  assert.equal(b.get({action:'get',email:sub.e,pin:'org:testmodel'}).row.q.T1,sub.q.T1);
});

test('the attendee screens omit deletion and model controls, and returning access needs name and email only', async () => {
  const b = backend(), sub = sample();
  b.post({sub, pin:'LegacyModel', gate:'synthetic-gate'});
  const before = JSON.stringify(b.tabs.Submissions.rows);
  const a = app({bridge:true, relay:req => req.action === 'put' ? b.post(req) : b.get(req)});
  assert.doesNotMatch(a.t.renderStep0(), /Favorite AI model|fpin|Delete my attendee entry|showDelete/);
  a.t.set({S:a.t.normalize({n:sub.n, e:sub.e}), pin:''});
  a.nodes.next.listeners.click(); await new Promise(setImmediate);
  assert.equal(a.t.state().step, 3);
  assert.equal(a.t.state().S.q.T1, sub.q.T1);
  assert.equal(JSON.stringify(b.tabs.Submissions.rows), before);
  assert.doesNotMatch(a.t.renderReading(), /Delete my attendee entry|showDelete/);
  assert.match(a.t.renderReading(), /Conference schedule/);
  assert.match(a.nodes.scheduleDialogContent.innerHTML, /Saturday, October 10/);
});

test('changing the name during a save cannot accept an earlier attendee identity', async () => {
  const a = app(); a.t.set({S:sample(), pin:''});
  let complete;
  const request = a.t.withKey(() => new Promise(resolve => { complete = resolve; }));
  a.t.state().S.n = 'Different attendee';
  const rejection = assert.rejects(request, err => err.code === 'identity_changed');
  complete({ok:true}); await rejection;
});


test('the progress block uses approved assignments independently of preferences and preserves answers', async () => {
  const sub = {...sample(), n:'Chen Shani', e:'attendee@example.test', r:['T6','T2','T4']};
  const before = JSON.stringify(sub);
  const a = app(); a.t.set({S:sub, saved:true, step:3});
  await a.t.loadAssignments();
  const progress = a.t.renderProgress();
  assert.match(progress, /Round 1 · Group 1H/);
  assert.match(progress, /T5 · Steering Open-Ended AI Ecosystems/);
  assert.match(progress, /Round 2 · Group 2C/);
  assert.match(progress, /Round 3 · Group 3J/);
  assert.ok(progress.indexOf('Your breakout groups') > progress.indexOf('data-go="one-on-one"'));
  assert.equal(JSON.stringify(a.t.state().S), before);
  assert.equal(a.requests.length, 0);
});

test('approved name aliases, accent variations, and attendees without submissions resolve to their own groups', async () => {
  for (const [name, groups] of [
    ['Alex Pentland', ['1F','2C','3I']],
    ['Jim Fan', ['1A','2H','3E']],
    ['Paul Aligica', ['1H','2F','3I']],
    ['Terrence W Deacon', ['1I','2B','3E']],
    ['Viktor Mu\u0308ller', ['1E','2E','3A']],
    ['Pavan Agrawal', ['1C','2H','3F']]
  ]) {
    const a = app(); a.t.set({S:{...sample(), n:name, e:'alias@example.test'}});
    await a.t.loadAssignments();
    const assigned = a.t.renderAssignedGroups();
    for (const group of groups) assert.ok(assigned.includes('Group ' + group), name + ': ' + group);
  }
});

test('moderators see a subtle role only beside the sessions they lead', async () => {
  const moderators = {
    'Jonathan Frankle':['1A','2D','3J'],
    'David Sloan Wilson':['1C','2A','3H'],
    'Erik Wang':['1D','2I'],
    'Joseph Henrich':['1E','3F'],
    'Sandy Pentland':['1F','2C','3I'],
    'Peter Fenton':['1G','3C'],
    'Athena Aktipis':['1H','2E','3D'],
    'Terrence Deacon':['1I','3E'],
    'James Tamplin':['1J','2H','3A'],
    'Rob Dunn':['2B'],
    'Paul Dragos Aligica':['2F'],
    'Geoffrey Miller':['2G'],
    'Peter M. Todd':['3G']
  };
  for (const [name, groups] of Object.entries(moderators)) {
    const sub = {...sample(), n:name, e:'moderator@example.test'};
    const before = JSON.stringify(sub);
    const a = app(); a.t.set({S:sub, saved:true, step:3});
    await a.t.loadAssignments();
    const assigned = a.t.renderAssignedGroups();
    const rows = [...assigned.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(match => match[1]);
    assert.equal(rows.length, 3, name);
    for (const row of rows) {
      const group = row.match(/Group ([123][A-J])/);
      assert.equal(row.includes(' · Moderating'), !!group && groups.includes(group[1]), name + ': ' + row);
    }
    assert.equal(JSON.stringify(a.t.state().S), before, name);
    assert.equal(a.requests.length, 0, name);
  }
});

test('moderator aliases keep the correct session roles', async () => {
  for (const [name, groups] of [
    ['Alex Pentland',['1F','2C','3I']],
    ['Paul Aligica',['2F']],
    ['Terrence W Deacon',['1I','3E']]
  ]) {
    const a = app(); a.t.set({S:{...sample(), n:name, e:'alias@example.test'}});
    await a.t.loadAssignments();
    const assigned = a.t.renderAssignedGroups();
    assert.equal((assigned.match(/ · Moderating/g) || []).length, groups.length, name);
    for (const group of groups) assert.ok(assigned.includes('Group ' + group + '<span class="pgassignment-role"> · Moderating</span>'), name);
  }
});

test('switching from a moderator to another attendee clears moderation labels', async () => {
  const a = app(); a.t.set({S:{...sample(), n:'Sandy Pentland', e:'first@example.test'}});
  await a.t.loadAssignments();
  assert.equal((a.t.renderAssignedGroups().match(/ · Moderating/g) || []).length, 3);
  a.t.set({S:{...sample(), n:'Rachel Calcott', e:'second@example.test'}});
  await a.t.loadAssignments();
  const assigned = a.t.renderAssignedGroups();
  assert.match(assigned, /Round 2 · Group 2G/);
  assert.doesNotMatch(assigned, /Moderating/);
});

test('an explicitly unassigned round stays empty rather than generating a group', async () => {
  const a = app(); a.t.set({S:{...sample(), n:'Joseph Henrich', e:'attendee@example.test'}});
  await a.t.loadAssignments();
  const assigned = a.t.renderAssignedGroups();
  assert.match(assigned, /Round 1 · Group 1E/);
  assert.match(assigned, /Round 2<[^]*?No subgroup assigned for this round/);
  assert.doesNotMatch(assigned, /Round 2 · Group/);
  assert.match(assigned, /Round 3 · Group 3F/);
});

test('unknown attendees and synthetic test accounts do not inherit another person’s assignments', async () => {
  for (const [name, email] of [['Unknown Attendee','unknown@example.test'], ['Chen Shani','test@example.invalid']]) {
    const a = app(); a.t.set({S:{...sample(), n:name, e:email}});
    await a.t.loadAssignments();
    assert.match(a.t.renderAssignedGroups(), /No subgroup assignment is listed for you/);
    assert.doesNotMatch(a.t.renderAssignedGroups(), /Group 1H|Group 2C|Group 3J/);
  }
});

test('an earlier assignment lookup cannot display groups after the attendee changes', async () => {
  const pending = [];
  const a = app({digest:(algorithm, bytes) => new Promise(resolve => {
    pending.push(() => require('node:crypto').webcrypto.subtle.digest(algorithm, bytes).then(resolve));
  })});
  a.t.set({S:{...sample(),n:'Chen Shani',e:'first@example.test'}});
  const first = a.t.loadAssignments();
  a.t.set({S:{...sample(),n:'Pavan Agrawal',e:'second@example.test'}});
  const second = a.t.loadAssignments();
  await Promise.all(pending.slice(0,2).map(f => f())); await first;
  assert.doesNotMatch(a.t.renderAssignedGroups(), /Group 1H/);
  await Promise.all(pending.slice(2).map(f => f())); await second;
  assert.match(a.t.renderAssignedGroups(), /Group 1C/);
  assert.doesNotMatch(a.t.renderAssignedGroups(), /Group 1H/);
});

test('the source document remains available if the browser cannot calculate a lookup fingerprint', async () => {
  const a = app({digest:() => Promise.reject(new Error('unavailable'))});
  a.t.set({S:{...sample(),n:'Chen Shani',e:'attendee@example.test'}});
  await a.t.loadAssignments();
  assert.match(a.t.renderAssignedGroups(), /Please open the subgroup assignments below/);
  assert.match(a.t.renderAssignedGroups(), /1f0_sPAezhQoBDyGYYH8nTOsiZiszgon42f8c79eUQp8/);
  assert.doesNotMatch(a.t.renderAssignedGroups(), /No subgroup assignment is listed/);
});

for (const [environment, disable] of [
  ['the encoding API is missing', context => { context.TextEncoder = undefined; }],
  ['the crypto API is missing', context => { context.crypto.subtle = undefined; }],
  ['the crypto provider throws immediately', context => {
    context.crypto.subtle.digest = () => { throw new Error('unavailable'); };
  }]
]) {
  test('assignment lookup shows the document fallback when ' + environment, async () => {
    const a = app({api:''});
    a.t.set({S:{...sample(),n:'Chen Shani',e:'attendee@example.test'},saved:true,step:3});
    disable(a.context);
    await a.t.loadAssignments();
    const progress = a.t.renderProgress();
    assert.match(progress, /Please open the subgroup assignments below/);
    assert.match(progress, /View subgroup assignments/);
    assert.doesNotMatch(progress, /Loading your assignments/);
    assert.match(a.t.renderReading(), /seminar prep/);
    assert.equal(a.requests.length, 0);
  });
}

test('Friday’s detailed schedule includes all breakout times and speakers while the other days retain their events', () => {
  const a = app(), schedule = a.t.renderSchedule();
  const friday = schedule.split('Friday, October 9')[1].split('Saturday, October 10')[0];
  assert.match(friday, /All times Eastern/);
  for (const [time, title] of [
    ['9:00–9:10 AM','Opening remarks: Peter Fenton &amp; David Sloan Wilson'],
    ['9:10–9:35 AM','Plenary 1: Joe Henrich'],
    ['9:35–10:00 AM','Plenary 2: Jonathan Frankle &amp; James Tamplin'],
    ['10:00–10:25 AM','Plenary 3: Sandy Pentland &amp; Athena Aktipis'],
    ['10:45–11:45 AM','Breakout groups round 1'],
    ['1:30–2:30 PM','Breakout groups round 2'],
    ['3:15–4:15 PM','Breakout groups round 3'],
    ['4:30–4:50 PM','Closing discussion'],
    ['4:50–5:00 PM','Conclusion'],
    ['5:30 PM','Reception at Harvard Faculty Club'],
    ['6:15 PM','Dinner']
  ]) assert.ok(friday.includes(time + '</span><span class="schedule-event-title">' + title), title);
  assert.match(friday, /Lightning talks/);
  assert.match(friday, /Sign up sheet for 1 min talks/);
  assert.match(schedule, /2:00–6:00 PM[^]*?Informal gathering at HEB/);
  assert.match(schedule, /6:00–7:00 PM[^]*?Welcome reception at Harvest/);
  assert.match(schedule, /Saturday, October 10[^]*?9:00 AM–12:00 PM[^]*?Unconference at HEB/);
});
