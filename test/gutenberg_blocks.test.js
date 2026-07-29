'use strict';

// scripts/lib/gutenberg_blocks.js のテスト(2026-07-29)。
// 実インシデント回帰確認: あま本部校のWordPress編集保存でCTAリンクが消失した問題の恒久対策。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toGutenbergBlocks } = require('../scripts/lib/gutenberg_blocks');

test('toGutenbergBlocks: 段落をwp:paragraphで囲む', () => {
  const result = toGutenbergBlocks('<p>本文です。</p>');
  assert.equal(result, '<!-- wp:paragraph -->\n<p>本文です。</p>\n<!-- /wp:paragraph -->');
});

test('toGutenbergBlocks: 段落内のCTAリンク(<a>)はそのまま保持される', () => {
  const result = toGutenbergBlocks('<p><a href="https://an-english.com/brand/anshingakujim/">無料相談はこちら</a></p>');
  assert.match(result, /<a href="https:\/\/an-english.com\/brand\/anshingakujim\/">無料相談はこちら<\/a>/);
  assert.match(result, /<!-- wp:paragraph -->/);
  assert.match(result, /<!-- \/wp:paragraph -->/);
});

test('toGutenbergBlocks: h2はwp:heading(level省略=2)で囲む', () => {
  const result = toGutenbergBlocks('<h2>見出し</h2>');
  assert.match(result, /<!-- wp:heading -->\n<h2 class="wp-block-heading">見出し<\/h2>\n<!-- \/wp:heading -->/);
});

test('toGutenbergBlocks: h3はwp:heading {"level":3}で囲む', () => {
  const result = toGutenbergBlocks('<h3>小見出し</h3>');
  assert.match(result, /<!-- wp:heading \{"level":3\} -->/);
});

test('toGutenbergBlocks: ulはwp:listで囲む', () => {
  const result = toGutenbergBlocks('<ul>\n<li>項目1</li>\n<li>項目2</li>\n</ul>');
  assert.match(result, /<!-- wp:list -->/);
  assert.match(result, /<ul class="wp-block-list">/);
  assert.match(result, /<li>項目1<\/li>/);
});

test('toGutenbergBlocks: olはwp:list {"ordered":true}で囲む', () => {
  const result = toGutenbergBlocks('<ol>\n<li>手順1</li>\n</ol>');
  assert.match(result, /<!-- wp:list \{"ordered":true\} -->/);
  assert.match(result, /<ol class="wp-block-list">/);
});

test('toGutenbergBlocks: 複数ブロックを順序通り変換する(段落+見出し+段落)', () => {
  const html = '<p>導入</p>\n<h2>本題</h2>\n<p>結論</p>';
  const result = toGutenbergBlocks(html);
  const order = [result.indexOf('導入'), result.indexOf('本題'), result.indexOf('結論')];
  assert.ok(order[0] < order[1] && order[1] < order[2], '元の順序が保たれているはず');
});

test('toGutenbergBlocks: 空文字列/空白のみはそのまま返す', () => {
  assert.equal(toGutenbergBlocks(''), '');
  assert.equal(toGutenbergBlocks('   '), '   ');
});

test('toGutenbergBlocks: 想定外のタグ(table等)が混ざっていれば例外を投げる(黙って内容を欠落させない)', () => {
  assert.throws(() => toGutenbergBlocks('<p>本文</p>\n<table><tr><td>データ</td></tr></table>'), /想定外のHTML構造/);
});

test('toGutenbergBlocks: 実データ相当(段落+見出しh2+h3+リスト+CTAリンクの組み合わせ)で内容が完全に保持される', () => {
  const html = [
    '<p>塾長のご挨拶です。</p>',
    '<h2>よくある悩み</h2>',
    '<h3>Q. 質問文</h3>',
    '<p>回答本文です。<strong>強調</strong>も含みます。</p>',
    '<ul>\n<li>ポイント1</li>\n<li>ポイント2</li>\n</ul>',
    '<h2>まとめ</h2>',
    '<p>まとめ文。</p>',
    '<p><a href="https://an-english.com/brand/anshingakujim/?utm_source=blog#offer">無料相談はこちら</a></p>',
  ].join('\n');
  const result = toGutenbergBlocks(html);
  assert.match(result, /<strong>強調<\/strong>/);
  assert.match(result, /<li>ポイント1<\/li>/);
  assert.match(result, /utm_source=blog#offer/);
  // ブロックコメントの対応が取れている(開始・終了ペアが揃っている)
  const opens = (result.match(/<!-- wp:(paragraph|heading|list)/g) || []).length;
  const closes = (result.match(/<!-- \/wp:(paragraph|heading|list) -->/g) || []).length;
  assert.equal(opens, closes);
});
