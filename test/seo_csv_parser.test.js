'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, parseCsvToObjects, stripBom } = require('../scripts/lib/seo/csv_parser');

test('stripBom: 先頭のBOMを除去する', () => {
  assert.equal(stripBom('﻿hello'), 'hello');
  assert.equal(stripBom('hello'), 'hello');
});

test('parseCsv: 単純なCSVを解析する', () => {
  const rows = parseCsv('a,b,c\n1,2,3\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('parseCsv: CRLF改行に対応する', () => {
  const rows = parseCsv('a,b\r\n1,2\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['1', '2']]);
});

test('parseCsv: ダブルクォート内のカンマを1セルとして扱う', () => {
  const rows = parseCsv('keyword,note\n"守山区, 塾",テスト\n');
  assert.deepEqual(rows, [['keyword', 'note'], ['守山区, 塾', 'テスト']]);
});

test('parseCsv: ダブルクォート内のエスケープ("")を1文字の"として扱う', () => {
  const rows = parseCsv('a\n"say ""hi"""\n');
  assert.deepEqual(rows, [['a'], ['say "hi"']]);
});

test('parseCsv: ダブルクォート内の改行を1セルとして扱う', () => {
  const rows = parseCsv('a,b\n"line1\nline2",2\n');
  assert.deepEqual(rows, [['a', 'b'], ['line1\nline2', '2']]);
});

test('parseCsv: 末尾に改行が無くても最終行を読み取る', () => {
  const rows = parseCsv('a,b\n1,2');
  assert.deepEqual(rows, [['a', 'b'], ['1', '2']]);
});

test('parseCsv: 空欄セルはそのまま空文字として保持する', () => {
  const rows = parseCsv('a,b,c\n1,,3\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', '', '3']]);
});

test('parseCsvToObjects: BOM付きUTF-8・見出し行をオブジェクト化する', () => {
  const { headers, rows } = parseCsvToObjects('﻿キーワード,検索数\n守山区 塾,10\n');
  assert.deepEqual(headers, ['キーワード', '検索数']);
  assert.deepEqual(rows, [{ キーワード: '守山区 塾', 検索数: '10' }]);
});

test('parseCsvToObjects: データ行が無ければ空配列', () => {
  const { headers, rows } = parseCsvToObjects('a,b\n');
  assert.deepEqual(headers, ['a', 'b']);
  assert.deepEqual(rows, []);
});
