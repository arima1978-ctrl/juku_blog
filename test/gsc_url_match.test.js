'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUrl, pathEndsWithId } = require('../scripts/lib/seo/gsc_url_match');

test('normalizeUrl: httpとhttpsを同一視する', () => {
  assert.equal(normalizeUrl('http://an-english.com/2026/07/14229/'), normalizeUrl('https://an-english.com/2026/07/14229/'));
});

test('normalizeUrl: wwwありなしを同一視する', () => {
  assert.equal(normalizeUrl('https://www.an-english.com/school/obata/'), normalizeUrl('https://an-english.com/school/obata/'));
});

test('normalizeUrl: 末尾スラッシュの有無を同一視する', () => {
  assert.equal(normalizeUrl('https://an-english.com/school/obata'), normalizeUrl('https://an-english.com/school/obata/'));
});

test('normalizeUrl: ホストは小文字化する', () => {
  assert.equal(normalizeUrl('https://AN-ENGLISH.COM/school/obata/'), normalizeUrl('https://an-english.com/school/obata/'));
});

test('normalizeUrl: 不正なURLはnullを返す', () => {
  assert.equal(normalizeUrl('not a url'), null);
  assert.equal(normalizeUrl(''), null);
  assert.equal(normalizeUrl(null), null);
});

test('pathEndsWithId: パスの末尾セグメントがIDと一致すればtrue', () => {
  const normalized = normalizeUrl('https://an-english.com/2026/07/14229/');
  assert.equal(pathEndsWithId(normalized, 14229), true);
});

test('pathEndsWithId: IDが部分文字列として含まれるだけでは誤マッチしない', () => {
  // 14229 は 142290 のパスセグメントの一部ではないので、末尾一致では誤検知しない
  const normalized = normalizeUrl('https://an-english.com/2026/07/142290/');
  assert.equal(pathEndsWithId(normalized, 14229), false);
});

test('pathEndsWithId: 異なるIDにはマッチしない', () => {
  const normalized = normalizeUrl('https://an-english.com/2026/07/14229/');
  assert.equal(pathEndsWithId(normalized, 14230), false);
});

test('pathEndsWithId: 未公開時の "?p=<id>" 形式のURLにはマッチしない(パスセグメントではないため)', () => {
  const normalized = normalizeUrl('https://an-english.com/?p=14313');
  assert.equal(pathEndsWithId(normalized, 14313), false);
});

test('pathEndsWithId: nullや不正な入力はfalseを返す', () => {
  assert.equal(pathEndsWithId(null, 123), false);
  assert.equal(pathEndsWithId('an-english.com/2026/07/14229/', null), false);
});
