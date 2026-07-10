'use strict';

// dns.lookup() を使うが、IPリテラルへのlookupはネットワークアクセスを伴わないため
// テスト環境(ネット接続無し)でも安定して動く。

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertUrlIsSafeToFetch, isAllowedDomain, isDisallowedIp } = require('../scripts/lib/exam_research/ssrf_guard');

test('isDisallowedIp: プライベート/ループバック/メタデータIPを検知する', () => {
  assert.equal(isDisallowedIp('127.0.0.1'), true);
  assert.equal(isDisallowedIp('10.0.0.5'), true);
  assert.equal(isDisallowedIp('172.16.0.1'), true);
  assert.equal(isDisallowedIp('192.168.1.1'), true);
  assert.equal(isDisallowedIp('169.254.169.254'), true);
  assert.equal(isDisallowedIp('::1'), true);
  assert.equal(isDisallowedIp('8.8.8.8'), false);
  assert.equal(isDisallowedIp('203.0.113.10'), false);
});

test('assertUrlIsSafeToFetch: localhostは明示的に禁止する', async () => {
  const result = await assertUrlIsSafeToFetch('http://localhost/');
  assert.equal(result.ok, false);
});

test('assertUrlIsSafeToFetch: IPリテラルのプライベートIPは禁止する', async () => {
  const result = await assertUrlIsSafeToFetch('http://127.0.0.1/secret');
  assert.equal(result.ok, false);
});

test('assertUrlIsSafeToFetch: メタデータIPは禁止する', async () => {
  const result = await assertUrlIsSafeToFetch('http://169.254.169.254/latest/meta-data/');
  assert.equal(result.ok, false);
});

test('assertUrlIsSafeToFetch: 許可されていないプロトコルを拒否する', async () => {
  const result = await assertUrlIsSafeToFetch('ftp://example.com/');
  assert.equal(result.ok, false);
});

test('assertUrlIsSafeToFetch: 公開IPリテラルは許可する', async () => {
  const result = await assertUrlIsSafeToFetch('http://8.8.8.8/');
  assert.equal(result.ok, true);
});

test('isAllowedDomain: 許可ドメイン(サブドメイン含む)のみ許可する', () => {
  const allowed = ['https://www.pref.aichi.jp/'];
  assert.equal(isAllowedDomain('https://www.pref.aichi.jp/page', allowed), true);
  assert.equal(isAllowedDomain('https://sub.www.pref.aichi.jp/page', allowed), true);
  assert.equal(isAllowedDomain('https://evil.example.com/', allowed), false);
});
