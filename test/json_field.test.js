'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { safeJsonParse } = require('../scripts/lib/json_field');

test('safeJsonParse: 正常なJSON文字列をパースできる', () => {
  assert.deepEqual(safeJsonParse('{"a":1}'), { a: 1 });
});

test('safeJsonParse: nullや空文字はnullを返す', () => {
  assert.equal(safeJsonParse(null), null);
  assert.equal(safeJsonParse(''), null);
  assert.equal(safeJsonParse(undefined), null);
});

test('safeJsonParse: 不正なJSONは例外を投げずrawで包んで返す', () => {
  assert.deepEqual(safeJsonParse('これはJSONではない'), { raw: 'これはJSONではない' });
});
