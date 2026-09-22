const fs=require('fs'),vm=require('vm'),assert=require('assert'),crypto=require('crypto');
const { test } = require('node:test');
const source=fs.readFileSync(require('path').join(__dirname,'../docs/sheet-backend.gs'),'utf8');
function backend(){
 const tabs={},cache=new Map();
 const newSheet=name=>tabs[name]={rows:[],getLastRow(){return this.rows.length},appendRow(r){this.rows.push(r.slice());return this},setFrozenRows(){},getRange(r,c,n=1,m=1){let sh=this;return {getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>sh.rows[r-1+i]?.[c-1+j]??'')),getValue:()=>sh.rows[r-1]?.[c-1]??'',setValues(vals){vals.forEach((row,i)=>row.forEach((v,j)=>{sh.rows[r-1+i]??=[];sh.rows[r-1+i][c-1+j]=v}));},setValue(v){sh.rows[r-1]??=[];sh.rows[r-1][c-1]=v},setFontWeight(){}}}};
 const c={console,Date,JSON,LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},SpreadsheetApp:{openById:()=>({getSheetByName:n=>tabs[n],insertSheet:newSheet})},CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)})},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(a,s)=>crypto.createHash(a).update(s).digest(),base64Encode:b=>Buffer.from(b).toString('base64'),base64EncodeWebSafe:s=>Buffer.from(s).toString('base64url'),base64DecodeWebSafe:s=>Buffer.from(s,'base64url'),newBlob:b=>({getDataAsString:()=>Buffer.from(b).toString()}),getUuid:()=>crypto.randomUUID()},ContentService:{MimeType:{JSON:'json',JAVASCRIPT:'js'},createTextOutput:s=>({body:s,setMimeType(){return this}})}};
 vm.runInNewContext(source,c); c.ADMIN_KEY='synthetic-admin';c.SALT='synthetic-salt';c.GATE_CODE='synthetic-gate';
 return {c,tabs,post:body=>JSON.parse(c.doPost({postData:{contents:JSON.stringify(body)}}).body),get:p=>JSON.parse(c.doGet({parameter:p}).body)};
}

const submission = () => ({ n:'Synthetic work-fields test', e:'work-test@example.invalid', a:'Test',
  w:'Research in cooperation', c:'https://example.com/', hopes:'Shared progress — café',
  moreWork:'https://example.com/paper\nLonger research description.', r:['T1','T2','T3'],q:{},read:{} });

test('live backend code adds columns to an older sheet and saves/restores new fields', () => {
  const b=backend(), sub=submission(), pin='test-model';
  const sh=b.c.sheet_();
  sh.rows[0]=sh.rows[0].slice(0,13); // Existing production schema.
  assert.equal(b.post({sub,pin,gate:'synthetic-gate'}).ok,true);
  assert.deepEqual(sh.rows[0].slice(13), ['Work','Link','Gathering goals and contribution','More work details (optional)']);
  assert.equal(sh.rows[1][15],sub.hopes); assert.equal(sh.rows[1][16],sub.moreWork);
  assert.deepEqual(b.get({action:'get',email:sub.e,pin}).row,sub);
  const oldClient={...sub};delete oldClient.hopes;delete oldClient.moreWork;
  assert.equal(b.post({sub:oldClient,pin}).ok,true);
  assert.equal(b.get({action:'get',email:sub.e,pin}).row.moreWork,sub.moreWork);
  sub.moreWork=''; sub.hopes='Updated goal';
  assert.equal(b.post({sub,pin}).ok,true);
  assert.equal(sh.rows.length,2);
  assert.equal(sh.rows[1][15],'Updated goal');assert.equal(sh.rows[1][16],'');
  assert.equal(b.get({action:'get',email:sub.e,pin}).row.moreWork,'');
  assert.equal(b.post({sub:{...sub,hopes:'Unauthorized'},pin:'wrong-model'}).error,'bad_pin');
  assert.equal(sh.rows[1][15],'Updated goal');
});

test('schema migration never overwrites an unexpected existing column', () => {
  const b=backend(),sh=b.c.sheet_();sh.rows[0][15]='User-owned column';
  assert.throws(()=>b.c.sheet_(),/Unexpected submission column 16/);
  assert.equal(sh.rows[0][15],'User-owned column');
});
