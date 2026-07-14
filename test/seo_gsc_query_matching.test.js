'use strict';

// Query Variant Matching Phase1: getGscAggregateForKeyword/getGscPagesForQueryが
// 既存のnormalizeKeyword()ルールで同一と判定されるGSC queryを統合することを確認する。
// token集合一致・部分一致・fuzzy一致は対象外(意味の異なる語は結合しない)。
//
// 各テストは同一の一時DBを共有するため(node:testはファイル内を順次実行)、
// 正の一致を検証するテストは他テストと衝突しない専用のquery文字列を使う。
// 否定(不一致)を検証するテストは、投入前後の集計値が変化しないことを比較する
// (他テストの累積データに依存せず頑健にするため)。

const os = require('node:os');
const path = require('node:path');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_seo_gsc_query_matching_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { closeDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');

after(() => {
  closeDb();
  try {
    fs.unlinkSync(process.env.JUKU_BLOG_DB_PATH);
  } catch {
    // 既に無ければ無視
  }
});

const nowIso = '2026-07-14T00:00:00.000Z';
function seed(query, impressions, clicks, position, page) {
  seoDb.upsertGscQueryRow(
    { site_property: 'https://an-english.com/', date: '2026-07-01', query, page: page || '/', clicks, impressions, position },
    nowIso
  );
}

test('正常系: 「守山区 塾」+「守山区 学習塾」の両方が存在する場合、両方の数値が合算されmatch_type=exact', () => {
  seed('守山区 塾クエリテスト1', 10, 1, 3);
  seed('守山区 学習塾クエリテスト1', 20, 2, 5);

  const agg = seoDb.getGscAggregateForKeyword('守山区 塾クエリテスト1');
  assert.equal(agg.impressions, 30); // 10+20
  assert.equal(agg.clicks, 3); // 1+2
  assert.equal(agg.ctr, 3 / 30); // 合計clicks÷合計impressions
  assert.equal(agg.avgPosition, (3 * 10 + 5 * 20) / 30); // impressions加重平均
  assert.equal(agg.match_type, 'exact'); // raw完全一致行(守山区 塾クエリテスト1自身)を含むため
  assert.ok(agg.matched_queries.includes('守山区 塾クエリテスト1'));
  assert.ok(agg.matched_queries.includes('守山区 学習塾クエリテスト1'));
  assert.equal(agg.matched_queries.length, 2); // 同じGSC行を二重集計しない(queryの種類数と一致)
});

test('正常系: raw完全一致が無くnormalized一致のみの場合はmatch_type=normalized_exact', () => {
  seed('名古屋市守山区 個別指導塾クエリテスト2', 15, 1, 8);

  const agg = seoDb.getGscAggregateForKeyword('守山区 個別指導クエリテスト2');
  assert.equal(agg.impressions, 15);
  assert.equal(agg.clicks, 1);
  assert.equal(agg.match_type, 'normalized_exact');
  assert.deepEqual(agg.matched_queries, ['名古屋市守山区 個別指導塾クエリテスト2']);
});

test('異常系: 「守山区 進学塾」は意味の異なる語のため統合されない', () => {
  seed('守山区 塾クエリテスト3', 10, 1, 3);
  const before = seoDb.getGscAggregateForKeyword('守山区 塾クエリテスト3');

  seed('守山区 進学塾クエリテスト3', 999, 999, 1); // 大きな値を混入させ、誤って合算されたら即座に分かるようにする
  const after1 = seoDb.getGscAggregateForKeyword('守山区 塾クエリテスト3');

  assert.deepEqual(after1, before); // 進学塾側の999が混入せず、投入前後で値が変化しない
  assert.ok(!after1.matched_queries.includes('守山区 進学塾クエリテスト3'));
});

test('異常系: 「旭区 塾」は地域が異なるため統合されない', () => {
  seed('守山区 塾クエリテスト4', 10, 1, 3);
  const before = seoDb.getGscAggregateForKeyword('守山区 塾クエリテスト4');

  seed('旭区 塾クエリテスト4', 999, 999, 1);
  const after1 = seoDb.getGscAggregateForKeyword('守山区 塾クエリテスト4');

  assert.deepEqual(after1, before);
  assert.ok(!after1.matched_queries.includes('旭区 塾クエリテスト4'));

  const aggAsahi = seoDb.getGscAggregateForKeyword('旭区 塾クエリテスト4');
  assert.equal(aggAsahi.impressions, 999);
  assert.ok(!aggAsahi.matched_queries.includes('守山区 塾クエリテスト4'));
});

test('getGscPagesForQuery: 同一pageにexact行とnormalized行がある場合、pageが重複せずimpressionsが合算される', () => {
  seed('瓢箪山 塾クエリテスト5', 10, 1, 3, '/school/obata/');
  seed('瓢箪山 学習塾クエリテスト5', 5, 0, 4, '/school/obata/'); // 同一page、normalized一致するquery違い
  seed('瓢箪山 学習塾クエリテスト5', 7, 0, 4, '/brand/anshingakujim/'); // 別page

  const pages = seoDb.getGscPagesForQuery('瓢箪山 塾クエリテスト5');
  assert.equal(pages.length, 2); // /school/obata/ と /brand/anshingakujim/ の2ページ(重複なし)
  const obata = pages.find((p) => p.page === '/school/obata/');
  assert.equal(obata.impressions, 15); // 10+5(同一pageで合算)
  const brand = pages.find((p) => p.page === '/brand/anshingakujim/');
  assert.equal(brand.impressions, 7);
});

test('後方互換: 一致が無ければgetGscAggregateForKeywordはnull、getGscPagesForQueryは空配列', () => {
  assert.equal(seoDb.getGscAggregateForKeyword('存在しないクエリXYZ'), null);
  assert.deepEqual(seoDb.getGscPagesForQuery('存在しないクエリXYZ'), []);
});
