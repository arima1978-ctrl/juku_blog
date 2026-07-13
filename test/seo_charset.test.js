'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeHtmlBuffer, normalizeEncodingName, detectFromContentType, detectFromMetaTag } = require('../scripts/lib/seo/charset');

test('normalizeEncodingName: 表記揺れを正規化する', () => {
  assert.equal(normalizeEncodingName('Shift-JIS'), 'shift_jis');
  assert.equal(normalizeEncodingName('SJIS'), 'shift_jis');
  assert.equal(normalizeEncodingName('EUC-JP'), 'euc-jp');
  assert.equal(normalizeEncodingName('UTF-8'), 'utf-8');
  assert.equal(normalizeEncodingName(null), null);
});

test('detectFromContentType: charsetパラメータを検出する', () => {
  assert.equal(detectFromContentType('text/html;charset=shift_jis'), 'shift_jis');
  assert.equal(detectFromContentType('text/html; charset=UTF-8'), 'utf-8');
  assert.equal(detectFromContentType('text/html'), null);
});

test('detectFromMetaTag: <meta charset>を検出する', () => {
  const buf = Buffer.from('<html><head><meta charset="Shift_JIS"></head></html>', 'latin1');
  assert.equal(detectFromMetaTag(buf), 'shift_jis');
});

test('detectFromMetaTag: http-equiv形式のmetaタグも検出する', () => {
  const buf = Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=EUC-JP">', 'latin1');
  assert.equal(detectFromMetaTag(buf), 'euc-jp');
});

test('decodeHtmlBuffer: Shift-JISのバイト列をContent-Typeヘッダーから正しくデコードする', () => {
  const encoded = Buffer.from(new Uint8Array([0x82, 0xa0])); // 「あ」のShift-JISバイト列
  const result = decodeHtmlBuffer(encoded, 'text/html;charset=shift_jis');
  assert.equal(result, 'あ');
});

test('decodeHtmlBuffer: ヘッダーが無くてもmetaタグから検出してデコードする', () => {
  const metaPrefix = Buffer.from('<meta charset="shift_jis">', 'latin1');
  const body = Buffer.from(new Uint8Array([0x82, 0xa0]));
  const combined = Buffer.concat([metaPrefix, body]);
  const result = decodeHtmlBuffer(combined, null);
  assert.ok(result.includes('あ'));
});

test('decodeHtmlBuffer: 検出できなければUTF-8として扱う', () => {
  const utf8Buf = Buffer.from('こんにちは', 'utf8');
  assert.equal(decodeHtmlBuffer(utf8Buf, 'text/html'), 'こんにちは');
});
