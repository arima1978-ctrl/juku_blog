'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAuthor, validateCategory, hasEditOthersPostsCapability } = require('../scripts/lib/wordpress_validation');

test('validateAuthor: IDと表示名が一致すればok', () => {
  const result = validateAuthor({ id: 13, name: '米澤由里子' }, { author_id: 13, author_display_name: '米澤由里子' });
  assert.equal(result.ok, true);
});

test('validateAuthor: 投稿者ID不一致はエラー', () => {
  const result = validateAuthor({ id: 27, name: '米澤由里子' }, { author_id: 13, author_display_name: '米澤由里子' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /投稿者ID不一致/);
});

test('validateAuthor: 表示名不一致はエラー(IDが一致していても)', () => {
  const result = validateAuthor({ id: 13, name: '有馬守' }, { author_id: 13, author_display_name: '米澤由里子' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /表示名不一致/);
});

test('validateAuthor: expectedにauthor_idが無ければ検証スキップでok', () => {
  const result = validateAuthor({ id: 999, name: 'なんでも' }, {});
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
});

test('validateAuthor: currentUserが取得できていない(null)場合はエラー', () => {
  const result = validateAuthor(null, { author_id: 13 });
  assert.equal(result.ok, false);
});

test('validateCategory: カテゴリーが存在すればok', () => {
  const result = validateCategory({ id: 263, name: 'コラム' }, 263);
  assert.equal(result.ok, true);
});

test('validateCategory: カテゴリーID不一致(見つからない)はエラー', () => {
  const result = validateCategory(null, 263);
  assert.equal(result.ok, false);
  assert.match(result.reason, /見つかりません/);
});

test('validateCategory: expectedCategoryIdが無ければ検証スキップでok', () => {
  const result = validateCategory(null, undefined);
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
});

test('hasEditOthersPostsCapability: capabilities.edit_others_posts=trueならtrue', () => {
  assert.equal(hasEditOthersPostsCapability({ id: 5, capabilities: { edit_others_posts: true } }), true);
});

test('hasEditOthersPostsCapability: capabilities.edit_others_posts=false(Author役割)ならfalse', () => {
  assert.equal(hasEditOthersPostsCapability({ id: 13, capabilities: { edit_posts: true, edit_others_posts: false } }), false);
});

test('hasEditOthersPostsCapability: capabilitiesフィールド自体が無ければfalse', () => {
  assert.equal(hasEditOthersPostsCapability({ id: 13 }), false);
});

test('hasEditOthersPostsCapability: userがnullならfalse', () => {
  assert.equal(hasEditOthersPostsCapability(null), false);
});
