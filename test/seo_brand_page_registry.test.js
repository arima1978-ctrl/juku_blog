'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateBrandPages,
  filterEnabled,
  findBrandPageIn,
  listEnabledBrandPages,
  findBrandPageByKeyword,
  getBrandPageById,
  getBrandPageByUrl,
} = require('../scripts/lib/seo/brand_page_registry');
const { loadSeoCompetitorsConfig } = require('../scripts/lib/config');

test('validateBrandPages: idが重複していれば例外', () => {
  assert.throws(
    () =>
      validateBrandPages([
        { id: 'a', url: 'https://example.com/a/', target_keywords: ['そろばん'] },
        { id: 'a', url: 'https://example.com/b/', target_keywords: ['英会話'] },
      ]),
    /重複/
  );
});

test('validateBrandPages: urlがhttps://でなければ例外', () => {
  assert.throws(
    () => validateBrandPages([{ id: 'a', url: 'http://example.com/a/', target_keywords: ['そろばん'] }]),
    /https/
  );
});

test('validateBrandPages: target_keywordsが空配列なら例外', () => {
  assert.throws(
    () => validateBrandPages([{ id: 'a', url: 'https://example.com/a/', target_keywords: [] }]),
    /target_keywords/
  );
});

test('validateBrandPages: idが無ければ例外', () => {
  assert.throws(() => validateBrandPages([{ url: 'https://example.com/a/', target_keywords: ['そろばん'] }]));
});

test('validateBrandPages: 妥当なデータは例外を投げない', () => {
  assert.doesNotThrow(() =>
    validateBrandPages([{ id: 'a', url: 'https://example.com/a/', target_keywords: ['そろばん'] }])
  );
});

test('filterEnabled: enabled=falseのページを除外する', () => {
  const pages = [
    { id: 'a', enabled: true, target_keywords: ['そろばん'] },
    { id: 'b', enabled: false, target_keywords: ['英会話'] },
    { id: 'c', target_keywords: ['習字'] }, // enabled省略 → 既定true扱い
  ];
  const result = filterEnabled(pages);
  assert.deepEqual(result.map((p) => p.id), ['a', 'c']);
});

test('findBrandPageIn: キーワードを含むかで判定する(部分一致文字列内包)', () => {
  const pages = [{ id: 'soroban', url: 'https://example.com/a/', target_keywords: ['そろばん'] }];
  assert.equal(findBrandPageIn(pages, 'そろばん 効果'), pages[0]);
  assert.equal(findBrandPageIn(pages, '英会話'), null);
  assert.equal(findBrandPageIn(pages, null), null);
});

test('listEnabledBrandPages: 実データ(5ブランドページ)がenabled=trueで登録されている', () => {
  const pages = listEnabledBrandPages();
  assert.equal(pages.length, 5);
  const ids = pages.map((p) => p.id).sort();
  assert.deepEqual(ids, ['eikaiwa', 'programming', 'shodo', 'shogi', 'soroban']);
  pages.forEach((p) => assert.equal(p.content_category, 'naraigoto'));
});

test('findBrandPageByKeyword: そろばん/英会話/習字/プログラミング/将棋のいずれからも対応するブランドページにマッチする', () => {
  assert.equal(findBrandPageByKeyword('そろばん').id, 'soroban');
  assert.equal(findBrandPageByKeyword('小幡 英会話').id, 'eikaiwa');
  assert.equal(findBrandPageByKeyword('習字 書き初め').id, 'shodo');
  assert.equal(findBrandPageByKeyword('プログラミング教室').id, 'programming');
  assert.equal(findBrandPageByKeyword('将棋 強くなる').id, 'shogi');
});

test('findBrandPageByKeyword: 対応するブランドページが無いキーワードはnull', () => {
  assert.equal(findBrandPageByKeyword('個別指導'), null);
});

test('getBrandPageById / getBrandPageByUrl: idまたはurlで取得できる(wp_page_idも保持)', () => {
  assert.equal(getBrandPageById('eikaiwa').wp_page_id, 546);
  assert.equal(getBrandPageByUrl('https://an-english.com/brand/aeclub/').id, 'eikaiwa');
  assert.equal(getBrandPageById('not_exist'), null);
});

test('config/brand_pages.yamlはconfig/seo_competitors.yamlと完全に分離している(自社ドメインが競合として登録されていない)', () => {
  const competitors = loadSeoCompetitorsConfig();
  const competitorDomains = (competitors.competitors || []).map((c) => c.domain);
  assert.ok(!competitorDomains.includes('an-english.com'));
});
