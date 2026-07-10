'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractFromHtml } = require('../scripts/lib/exam_research/html_extract');

const SAMPLE_HTML = `
<html>
<head><title>令和9年度愛知県公立高等学校入学者選抜</title><style>.x{color:red}</style></head>
<body>
  <nav>ナビゲーション</nav>
  <script>console.log('should be removed')</script>
  <h1>入学者選抜情報</h1>
  <p>学力検査は令和9年度実施予定です。</p>
  <a href="/files/schedule2027.pdf">日程PDF(令和9年度)</a>
  <a href="/files/schedule2027.pdf">重複リンク</a>
  <a href="https://example.com/other.html">他ページ</a>
  <footer>フッター</footer>
</body>
</html>
`;

test('extractFromHtml: title・本文テキスト・PDFリンクを抽出する(script/style/nav/footer除去)', () => {
  const result = extractFromHtml(SAMPLE_HTML, 'https://www.pref.aichi.jp/soshiki/kotogakko/0000027366.html');
  assert.equal(result.title, '令和9年度愛知県公立高等学校入学者選抜');
  assert.ok(result.text.includes('学力検査は令和9年度実施予定です'));
  assert.ok(!result.text.includes('should be removed'));
  assert.ok(!result.text.includes('ナビゲーション'));
  assert.ok(!result.text.includes('フッター'));
});

test('extractFromHtml: PDFリンクは絶対URL化・重複除去される', () => {
  const result = extractFromHtml(SAMPLE_HTML, 'https://www.pref.aichi.jp/soshiki/kotogakko/0000027366.html');
  assert.equal(result.pdfLinks.length, 1);
  assert.equal(result.pdfLinks[0].url, 'https://www.pref.aichi.jp/files/schedule2027.pdf');
});
