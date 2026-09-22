const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('submission payload preserves Unicode through sheet storage and restore', () => {
  let storedRow;
  const context = {
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      Charset: { UTF_8: 'utf8' },
      // Model the lossy default observed on the deployed Apps Script service.
      base64EncodeWebSafe: (text, charset) => Buffer.from(
        charset === 'utf8' ? text : text.replace(/[^\x00-\x7f]/g, '?'), 'utf8'
      ).toString('base64url'),
      base64DecodeWebSafe: text => Buffer.from(text, 'base64url'),
      newBlob: bytes => ({ getDataAsString: () => bytes.toString('utf8') })
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../docs/sheet-backend.gs'), 'utf8'), context);
  // Isolate encoding from authorization and Google's spreadsheet APIs.
  Object.assign(context, {
    sheet_: () => ({ appendRow: row => { storedRow = row; } }),
    findRow_: () => -1, hash_: () => 'synthetic-hash', stored_: x => x,
    locked_: () => false, gateOpen_: () => true, clearFails_: () => {}, out_: x => x
  });
  const sub = { n: 'Test — José 王', e: 'test@example.invalid', a: 'Zürich',
    w: '人工知能 🧪', c: 'https://example.com/', r: ['T1', 'T2', 'T3'],
    q: { T1: 'How does “coöperation” evolve?' }, t: 'Évolution', read: { example: 1 } };
  const result = context.doPost({ postData: { contents: JSON.stringify({ sub, pin: 'synthetic-model' }) } });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(context.rowToSub_(storedRow))), sub);
});
