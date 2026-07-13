'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractFromHtml } = require('../scripts/lib/seo/html_extract');

const SAMPLE_HTML = `
<html>
<head>
  <title>守山区の個別指導塾なら〇〇塾</title>
  <meta name="description" content="守山区・小幡エリアの個別指導塾です。">
  <link rel="canonical" href="https://competitor.example.com/school/moriyama/">
  <script>console.log('should be removed')</script>
  <style>.x{color:red}</style>
</head>
<body>
  <nav><a href="/nav-link">ナビ</a></nav>
  <header>ヘッダー</header>
  <h1>守山区の個別指導塾</h1>
  <h2>料金について</h2>
  <h3>体験授業のご案内</h3>
  <p>本文本文本文<a href="/course?utm_source=x&utm_medium=y">コース案内</a></p>
  <a href="https://other.example.com/external">外部リンク</a>
  <a href="#section">フラグメントのみ</a>
  <footer>フッター</footer>
  <aside>サイドバー</aside>
</body>
</html>
`;

test('extractFromHtml: title/meta description/canonicalを抽出する', () => {
  const result = extractFromHtml(SAMPLE_HTML, 'https://competitor.example.com/school/moriyama/index.html');
  assert.equal(result.title, '守山区の個別指導塾なら〇〇塾');
  assert.equal(result.metaDescription, '守山区・小幡エリアの個別指導塾です。');
  assert.equal(result.canonicalUrl, 'https://competitor.example.com/school/moriyama/');
});

test('extractFromHtml: H1〜H3を出現順に抽出する', () => {
  const result = extractFromHtml(SAMPLE_HTML, 'https://competitor.example.com/school/moriyama/');
  assert.deepEqual(result.headings, [
    { level: 'h1', text: '守山区の個別指導塾' },
    { level: 'h2', text: '料金について' },
    { level: 'h3', text: '体験授業のご案内' },
  ]);
});

test('extractFromHtml: script/style/nav/header/footer/asideを本文から除去する', () => {
  const result = extractFromHtml(SAMPLE_HTML, 'https://competitor.example.com/school/moriyama/');
  assert.ok(!result.bodyText.includes('console.log'));
  assert.ok(!result.bodyText.includes('color:red'));
  assert.ok(!result.bodyText.includes('ナビ'));
  assert.ok(!result.bodyText.includes('ヘッダー'));
  assert.ok(!result.bodyText.includes('フッター'));
  assert.ok(!result.bodyText.includes('サイドバー'));
  assert.ok(result.bodyText.includes('本文本文本文'));
});

test('extractFromHtml: 内部リンクを絶対URLで抽出し外部ドメインも含めるがfragmentのみは除外する', () => {
  const result = extractFromHtml(SAMPLE_HTML, 'https://competitor.example.com/school/moriyama/');
  assert.ok(result.links.some((l) => l.startsWith('https://competitor.example.com/course')));
  assert.ok(result.links.some((l) => l === 'https://other.example.com/external'));
  assert.ok(!result.links.some((l) => l.includes('#section')));
});
