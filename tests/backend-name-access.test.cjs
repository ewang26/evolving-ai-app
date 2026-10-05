const { test } = require('node:test');
const assert = require('node:assert/strict');
const { backend } = require('./helpers/sheet-backend.cjs');
const sub = () => ({ n:'Léa Researcher', e:'lea@example.invalid', a:'Test', r:['T1','T2','T3'], q:{T1:'Original question?'}, read:{} });

test('name/email lookup normalizes case and whitespace and leaves legacy rows untouched', () => {
  const b = backend(), attendee = sub();
  assert.equal(b.post({sub:attendee, pin:'LegacyModel', gate:'synthetic-gate'}).ok,true);
  const before = JSON.stringify(b.tabs.Submissions.rows);
  const result = b.get({action:'get', email:' LEA@EXAMPLE.INVALID ', pin:'name:  LÉA   RESEARCHER '});
  assert.equal(result.row.q.T1,attendee.q.T1);
  assert.equal(JSON.stringify(b.tabs.Submissions.rows),before);
  assert.equal(b.get({action:'get',email:attendee.e,pin:'LegacyModel'}).ok,true);
});

test('wrong names and mismatched name/email writes cannot replace an existing attendee', () => {
  const b = backend(), attendee = sub();
  b.post({sub:attendee,pin:'LegacyModel',gate:'synthetic-gate'});
  const before = JSON.stringify(b.tabs.Submissions.rows);
  assert.equal(b.get({action:'get',email:attendee.e,pin:'name:Someone Else'}).error,'bad_pin');
  assert.equal(b.post({sub:{...attendee,n:'Someone Else'},pin:'name:Someone Else'}).error,'bad_pin');
  assert.equal(b.post({sub:attendee,pin:'name:Someone Else'}).error,'bad_pin');
  assert.equal(JSON.stringify(b.tabs.Submissions.rows),before);
});

test('name-based saves retain legacy keys and revision conflicts still protect newer answers', () => {
  const b = backend(), attendee = sub();
  b.post({sub:attendee,pin:'LegacyModel',gate:'synthetic-gate'});
  const key = b.tabs.Submissions.rows[1][10];
  const first = b.get({action:'get',email:attendee.e,pin:'name:Léa Researcher'});
  const newer = {...attendee,q:{T1:'Updated question?'}};
  assert.equal(b.post({sub:newer,pin:'name:Léa Researcher',ifMatch:first.rev}).ok,true);
  assert.equal(b.tabs.Submissions.rows[1][10],key);
  assert.equal(b.post({sub:attendee,pin:'name:Léa Researcher',ifMatch:first.rev}).error,'conflict');
  assert.equal(b.get({action:'get',email:attendee.e,pin:'LegacyModel'}).row.q.T1,newer.q.T1);
});

test('new name-based registration requires the invitation and can fetch its discussion and directory', () => {
  const b = backend(), attendee = sub(), pin = 'name:Léa Researcher';
  assert.equal(b.post({sub:attendee,pin}).error,'bad_gate');
  assert.equal(b.post({sub:attendee,pin,gate:'synthetic-gate'}).ok,true);
  assert.equal(b.get({action:'get',email:attendee.e,pin}).row.n,attendee.n);
  assert.equal(b.get({action:'counts',email:attendee.e,pin}).ok,true);
  assert.equal(b.get({action:'topic',topic:'T1',email:attendee.e,pin}).ok,true);
  assert.equal(b.get({action:'participants',email:attendee.e,pin}).ok,true);
});
