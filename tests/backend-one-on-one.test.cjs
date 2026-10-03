const { test } = require('node:test');
const assert = require('node:assert/strict');
const { backend } = require('./helpers/sheet-backend.cjs');
const sub = (email = 'attendee@seminar.test', name = 'Attendee') => ({
  n:name, e:email, a:'Institution', r:['T1','T2','T3'], q:{}, read:{}
});
const directory = () => [
  {key:'alice', name:'Alice', affiliation:'University A', emails:['alice@seminar.test','alice-alt@seminar.test'], names:['Alice Example']},
  {key:'bob', name:'Bob', affiliation:'Institute B', emails:['bob@seminar.test'], names:[]},
  {key:'not-submitted', name:'Carol', affiliation:'University C', emails:['carol@seminar.test'], names:[]}
];
const put = (b, s, more = {}) => b.post({action:'put', sub:s, pin:'test-model', gate:'synthetic-gate', ...more});

test('reviewed directory includes non-submitters, excludes unreviewed rows and returns no private fields', () => {
  const b=backend(); b.c.installOneOnOneDirectory_(directory());
  put(b,sub('alice@seminar.test','Alice')); put(b,sub('junk@seminar.test','Test row'));
  const params={action:'participants',email:'alice@seminar.test',pin:'test-model'};
  const list=b.get(params).participants;
  assert.deepEqual(list.map(p=>p.name),['Bob','Carol']);
  assert.ok(list.every(p=>Object.keys(p).sort().join(',')==='affiliation,id,name'));
  assert.doesNotMatch(JSON.stringify(list),/@seminar|emails|names|key/);
  assert.equal(b.get({...params,pin:'wrong-model'}).error,'bad_pin');
  assert.equal(b.get({action:'participants',email:'new@seminar.test'}).error,'bad_gate');
  assert.equal(b.get({action:'participants',email:'new@seminar.test',gate:'synthetic-gate'}).participants.length,3);
});

test('alternate emails and reviewed name aliases exclude the same person without conflating duplicate names', () => {
  const b=backend(); b.c.installOneOnOneDirectory_(directory());
  const get=email=>b.get({action:'participants',email,gate:'synthetic-gate',name:'Alice Example'});
  assert.deepEqual(get('alice-alt@seminar.test').participants.map(p=>p.name),['Bob','Carol']);
  assert.deepEqual(get('new-alice@seminar.test').participants.map(p=>p.name),['Bob','Carol']);
  const d=directory(); d[1].name='Alice'; b.c.installOneOnOneDirectory_(d);
  assert.equal(get('alice@seminar.test').participants.filter(p=>p.name==='Alice').length,1);
});

test('preference saves canonical labels, survives restore/legacy updates, and can be explicitly cleared', () => {
  const b=backend(); b.c.installOneOnOneDirectory_(directory()); const s=sub('alice@seminar.test','Alice');
  const pick=JSON.parse(JSON.stringify(b.c.participants_(s.e,s.n).find(p=>p.name==='Bob')));
  s.oneOnOne={...pick,name:'Spoofed description'};
  assert.equal(put(b,s).ok,true);
  const read=()=>b.get({action:'get',email:s.e,pin:'test-model'}).row;
  assert.deepEqual(read().oneOnOne,pick);
  assert.equal(b.tabs.Submissions.rows[1][17],'Bob: Institute B');
  const legacy={...s}; delete legacy.oneOnOne;
  assert.equal(put(b,legacy).ok,true); assert.deepEqual(read().oneOnOne,pick);
  s.oneOnOne=null; assert.equal(put(b,s).ok,true); assert.equal(read().oneOnOne,null);
  assert.equal(b.tabs.Submissions.rows[1][17],'');
});

test('unknown, self, and cross-audience selections cannot overwrite a preference', () => {
  const b=backend(); b.c.installOneOnOneDirectory_(directory()); const s=sub('alice@seminar.test','Alice');
  put(b,s);
  for(const id of [b.c.participantId_('alice'), b.c.participantId_('unknown'), b.c.participantId_('review@example.invalid')]) {
    assert.equal(put(b,{...s,oneOnOne:{id,name:'Fake',affiliation:'Fake'}}).error,'invalid_preference');
    assert.equal(b.get({action:'get',email:s.e,pin:'test-model'}).row.oneOnOne,undefined);
  }
  const testSub=sub('test@example.invalid','Test'); put(b,testSub);
  assert.equal(b.get({action:'participants',email:testSub.e,pin:'test-model'}).participants.length,0);
});

test('directory IDs survive label and email corrections and stale writes keep revision protection', () => {
  const b=backend(), d=directory(); b.c.installOneOnOneDirectory_(d);
  const s=sub('alice@seminar.test','Alice'), pick=b.c.participants_(s.e,s.n)[0];
  s.oneOnOne=pick; put(b,s);
  const params={action:'get',email:s.e,pin:'test-model'}, before=b.get(params);
  d[1].affiliation='Updated Institute'; d[1].emails.push('new-bob@seminar.test'); b.c.installOneOnOneDirectory_(d);
  assert.equal(b.c.participants_(s.e,s.n)[0].id,pick.id);
  assert.equal(put(b,{...s,a:'Updated answer'},{ifMatch:before.rev}).ok,true);
  assert.equal(put(b,s,{ifMatch:before.rev}).error,'conflict');
});

test('directory storage respects property limits, preserves Unicode, and a failed install keeps the old manifest', () => {
  const b=backend(); const d=Array.from({length:63},(_,i)=>({key:'person'+i,name:'Person '+i+' Müller',affiliation:'University '.repeat(15),emails:['p'+i+'@seminar.test'],names:[]}));
  assert.equal(b.c.installOneOnOneDirectory_(d).participants,63);
  assert.ok([...b.properties.values()].every(value=>Buffer.byteLength(value,'utf8')<9000));
  assert.equal(b.c.approvedDirectory_().length,63); assert.equal(b.c.approvedDirectory_()[0].name,d[0].name);
  const before=b.properties.get('ONE_ON_ONE_DIRECTORY');
  assert.throws(()=>b.c.installOneOnOneDirectory_([d[0],d[0]]),/Invalid/);
  assert.equal(b.properties.get('ONE_ON_ONE_DIRECTORY'),before);
});

test('authenticated private relay serves the reviewed directory and missing setup never exposes submissions', () => {
  const b=backend(); put(b,sub());
  assert.equal(b.get({action:'participants',email:sub().e,pin:'test-model'}).error,'backend_error');
  b.c.installOneOnOneDirectory_(directory());
  const id='a'.repeat(32);
  assert.equal(b.post({action:'relay',requestId:id,request:{action:'participants',email:sub().e,pin:'test-model'}}).accepted,true);
  const response=JSON.parse(b.get({action:'poll',requestId:id,part:0}).chunk);
  assert.equal(response.participants.length,3);
});
