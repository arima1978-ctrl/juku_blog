'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchExternalUrl } = require('../scripts/lib/seo/fetcher');

const BASE_OPTIONS = {
  userAgent: 'JukuBlogSEOResearchBot/1.0 (+https://an-english.com/school/obata/)',
  timeoutMs: 5000,
  intervalMs: 0,
  maxRetries: 1,
};

// これらはIPリテラルを直接渡すため実際のDNS問い合わせ・ネットワーク通信を伴わない
// (assertUrlIsSafeToFetchのdns.lookupはIPリテラルに対しては即時解決される)。
// HTTPトランスポート層(実際のリトライ/リダイレクト追跡)の結合テストは、
// 愛知県高校入試機能のfetcher.js同様、実サイトへの依存を避けるため用意していない
// (既知のテストギャップとして報告済み)。

test('fetchExternalUrl: プライベートIPはSSRF_BLOCKEDで即座に拒否する(ネットワーク未使用)', async () => {
  const result = await fetchExternalUrl('https://127.0.0.1/admin', BASE_OPTIONS);
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'SSRF_BLOCKED');
});

test('fetchExternalUrl: メタデータIPはSSRF_BLOCKEDで拒否する', async () => {
  const result = await fetchExternalUrl('http://169.254.169.254/latest/meta-data/', BASE_OPTIONS);
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'SSRF_BLOCKED');
});

test('fetchExternalUrl: localhostはSSRF_BLOCKEDで拒否する', async () => {
  const result = await fetchExternalUrl('https://localhost/', BASE_OPTIONS);
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'SSRF_BLOCKED');
});

test('fetchExternalUrl: 許可プロトコル外(ftp)はSSRF_BLOCKEDで拒否する', async () => {
  const result = await fetchExternalUrl('ftp://127.0.0.1/file', BASE_OPTIONS);
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'SSRF_BLOCKED');
});
