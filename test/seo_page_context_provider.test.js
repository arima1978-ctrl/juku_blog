'use strict';

// scripts/lib/seo/page_context_provider.js のユニットテスト。
// fetchFnを注入することで、実際のネットワーク接続(an-english.com等)は一切行わない。

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { fetchPageContext, BODY_EXCERPT_LENGTH } = require('../scripts/lib/seo/page_context_provider');

const BASE_OPTIONS = {
  allowedBaseUrls: ['https://an-english.com/'],
  userAgent: 'test-agent',
  timeoutMs: 1000,
  intervalMs: 0,
  maxRetries: 0,
};

function makeHtml({ title = '', headings = [], body = '' } = {}) {
  const headingHtml = headings.map(([level, text]) => `<${level}>${text}</${level}>`).join('');
  return `<html><head><title>${title}</title></head><body>${headingHtml}<p>${body}</p></body></html>`;
}

function fakeFetchFn(response) {
  return async () => response;
}

test('正常系: titleを取得する', async () => {
  const html = makeHtml({ title: '小幡教室 | アン進学ジム', body: '本文' });
  const result = await fetchPageContext(
    'https://an-english.com/school/obata/',
    BASE_OPTIONS,
    { fetchFn: fakeFetchFn({ ok: true, statusCode: 200, body: Buffer.from(html), contentType: 'text/html', finalUrl: 'https://an-english.com/school/obata/' }) }
  );
  assert.equal(result.status, 'fetched');
  assert.equal(result.title, '小幡教室 | アン進学ジム');
});

test('正常系: h1を取得する', async () => {
  const html = makeHtml({ title: 't', headings: [['h1', '小幡教室のご案内']], body: '本文' });
  const result = await fetchPageContext('https://an-english.com/school/obata/', BASE_OPTIONS, {
    fetchFn: fakeFetchFn({ ok: true, statusCode: 200, body: Buffer.from(html), finalUrl: 'https://an-english.com/school/obata/' }),
  });
  assert.ok(result.headings.includes('小幡教室のご案内'));
});

test('正常系: h2を取得する', async () => {
  const html = makeHtml({ title: 't', headings: [['h1', '見出し1'], ['h2', 'アクセス']], body: '本文' });
  const result = await fetchPageContext('https://an-english.com/school/obata/', BASE_OPTIONS, {
    fetchFn: fakeFetchFn({ ok: true, statusCode: 200, body: Buffer.from(html), finalUrl: 'https://an-english.com/school/obata/' }),
  });
  assert.ok(result.headings.includes('アクセス'));
});

test('正常系: h3は除外される(headingsに含まれない)', async () => {
  const html = makeHtml({ title: 't', headings: [['h1', '見出し1'], ['h2', '見出し2'], ['h3', '見出し3']], body: '本文' });
  const result = await fetchPageContext('https://an-english.com/school/obata/', BASE_OPTIONS, {
    fetchFn: fakeFetchFn({ ok: true, statusCode: 200, body: Buffer.from(html), finalUrl: 'https://an-english.com/school/obata/' }),
  });
  assert.deepEqual(result.headings, ['見出し1', '見出し2']);
});

test('正常系: bodyExcerptは1500文字以内、空白・改行が正規化される', async () => {
  const rawBody = '本文　　\n\n開始です。'.repeat(200); // 十分に長い本文(空白・改行混じり)
  const html = makeHtml({ title: 't', body: rawBody });
  const result = await fetchPageContext('https://an-english.com/school/obata/', BASE_OPTIONS, {
    fetchFn: fakeFetchFn({ ok: true, statusCode: 200, body: Buffer.from(html), finalUrl: 'https://an-english.com/school/obata/' }),
  });
  assert.ok(result.bodyExcerpt.length <= BODY_EXCERPT_LENGTH);
  assert.ok(!/\n/.test(result.bodyExcerpt)); // 改行が正規化され残っていない
  assert.ok(!/ {2,}/.test(result.bodyExcerpt)); // 連続する空白が正規化され残っていない
});

test('status=fetchedになる(正常取得・本文あり)', async () => {
  const html = makeHtml({ title: 't', body: '本文あり' });
  const result = await fetchPageContext('https://an-english.com/school/obata/', BASE_OPTIONS, {
    fetchFn: fakeFetchFn({ ok: true, statusCode: 200, body: Buffer.from(html), finalUrl: 'https://an-english.com/school/obata/' }),
  });
  assert.equal(result.status, 'fetched');
});

test('contentHashは本文全体からSHA-256で決定的に生成される(同じ本文なら同じHash)', async () => {
  const html = makeHtml({ title: 't', body: '同一本文テスト' });
  const r1 = await fetchPageContext('https://an-english.com/school/obata/', BASE_OPTIONS, {
    fetchFn: fakeFetchFn({ ok: true, statusCode: 200, body: Buffer.from(html), finalUrl: 'https://an-english.com/school/obata/' }),
  });
  const r2 = await fetchPageContext('https://an-english.com/school/obata/', BASE_OPTIONS, {
    fetchFn: fakeFetchFn({ ok: true, statusCode: 200, body: Buffer.from(html), finalUrl: 'https://an-english.com/school/obata/' }),
  });
  assert.equal(r1.contentHash, r2.contentHash);
  assert.equal(r1.contentHash.length, 64); // sha256 hex digest長
});

test('本文変更でcontentHashが変わる', async () => {
  const htmlA = makeHtml({ title: 't', body: '本文A' });
  const htmlB = makeHtml({ title: 't', body: '本文B' });
  const rA = await fetchPageContext('https://an-english.com/school/obata/', BASE_OPTIONS, {
    fetchFn: fakeFetchFn({ ok: true, statusCode: 200, body: Buffer.from(htmlA), finalUrl: 'https://an-english.com/school/obata/' }),
  });
  const rB = await fetchPageContext('https://an-english.com/school/obata/', BASE_OPTIONS, {
    fetchFn: fakeFetchFn({ ok: true, statusCode: 200, body: Buffer.from(htmlB), finalUrl: 'https://an-english.com/school/obata/' }),
  });
  assert.notEqual(rA.contentHash, rB.contentHash);
});

test('finalUrlを保持する(リダイレクトがあった場合に確認できる)', async () => {
  const html = makeHtml({ title: 't', body: '本文' });
  const result = await fetchPageContext('https://an-english.com/school/obata', BASE_OPTIONS, {
    fetchFn: fakeFetchFn({ ok: true, statusCode: 200, body: Buffer.from(html), finalUrl: 'https://an-english.com/school/obata/' }),
  });
  assert.equal(result.url, 'https://an-english.com/school/obata'); // 元URLを保持
  assert.equal(result.finalUrl, 'https://an-english.com/school/obata/'); // リダイレクト後のURL
});

test('robots拒否 → blocked', async () => {
  const result = await fetchPageContext('https://an-english.com/school/obata/', BASE_OPTIONS, {
    fetchFn: fakeFetchFn({ ok: false, reason: 'robots.txtにより取得が禁止されています', errorCode: 'ROBOTS_DISALLOWED' }),
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.errorCode, 'ROBOTS_DISALLOWED');
});

test('SSRF拒否 → blocked', async () => {
  const result = await fetchPageContext('https://an-english.com/school/obata/', BASE_OPTIONS, {
    fetchFn: fakeFetchFn({ ok: false, reason: 'プライベートIPへの解決を検知しました', errorCode: 'SSRF_BLOCKED' }),
  });
  assert.equal(result.status, 'blocked');
});

test('許可ドメイン外 → blocked', async () => {
  const result = await fetchPageContext('https://an-english.com/school/obata/', BASE_OPTIONS, {
    fetchFn: fakeFetchFn({ ok: false, reason: '許可ドメイン外です', errorCode: 'DOMAIN_NOT_ALLOWED' }),
  });
  assert.equal(result.status, 'blocked');
});

test('HTTPエラー → fetch_failed', async () => {
  const result = await fetchPageContext('https://an-english.com/school/obata/', BASE_OPTIONS, {
    fetchFn: fakeFetchFn({ ok: false, reason: 'HTTP 404', errorCode: 'HTTP_ERROR' }),
  });
  assert.equal(result.status, 'fetch_failed');
});

test('fetch失敗(タイムアウト等) → fetch_failed', async () => {
  const result = await fetchPageContext('https://an-english.com/school/obata/', BASE_OPTIONS, {
    fetchFn: fakeFetchFn({ ok: false, reason: '接続タイムアウト', errorCode: 'FETCH_FAILED' }),
  });
  assert.equal(result.status, 'fetch_failed');
});

test('未知のerrorCodeは安全側に倒してfetch_failedとする', async () => {
  const result = await fetchPageContext('https://an-english.com/school/obata/', BASE_OPTIONS, {
    fetchFn: fakeFetchFn({ ok: false, reason: '不明なエラー', errorCode: 'SOME_FUTURE_ERROR_CODE' }),
  });
  assert.equal(result.status, 'fetch_failed');
});

test('本文無し → empty', async () => {
  const html = '<html><head><title>タイトルのみ</title></head><body></body></html>';
  const result = await fetchPageContext('https://an-english.com/school/obata/', BASE_OPTIONS, {
    fetchFn: fakeFetchFn({ ok: true, statusCode: 200, body: Buffer.from(html), finalUrl: 'https://an-english.com/school/obata/' }),
  });
  assert.equal(result.status, 'empty');
});

test('不正なHTMLでも例外を投げず安全に処理する', async () => {
  const malformedHtml = '<html><head><title>壊れたHTML<body><h1>見出し<p>本文が閉じタグ無しで続く<div><span>';
  await assert.doesNotReject(async () => {
    const result = await fetchPageContext('https://an-english.com/school/obata/', BASE_OPTIONS, {
      fetchFn: fakeFetchFn({ ok: true, statusCode: 200, body: Buffer.from(malformedHtml), finalUrl: 'https://an-english.com/school/obata/' }),
    });
    assert.ok(['fetched', 'empty'].includes(result.status));
  });
});

test('reason/errorCodeは返すが、内部スタックトレースや秘密情報は含まれない', async () => {
  const result = await fetchPageContext('https://an-english.com/school/obata/', BASE_OPTIONS, {
    fetchFn: fakeFetchFn({ ok: false, reason: 'HTTP 500', errorCode: 'HTTP_ERROR' }),
  });
  const serialized = JSON.stringify(result);
  assert.ok(!/at\s+.*\(.*:\d+:\d+\)/.test(serialized)); // スタックトレース行の典型パターンが含まれない
  assert.ok(!/GSC_PRIVATE_KEY|BEGIN PRIVATE KEY/.test(serialized));
});
