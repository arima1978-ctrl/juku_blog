'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { KeywordMetricsProvider, CsvKeywordMetricsProvider } = require('../scripts/lib/seo/keyword_metrics_provider');

test('KeywordMetricsProvider: 未実装は例外を投げる', async () => {
  const provider = new KeywordMetricsProvider();
  await assert.rejects(() => provider.getKeywordIdeas({}));
  await assert.rejects(() => provider.getHistoricalMetrics({}));
});

test('CsvKeywordMetricsProvider: 英語列名(カンマ区切り数値含む)を解析する', () => {
  const csv = 'Keyword,Avg. monthly searches,Competition,Competition (indexed value),Top of page bid (low range),Top of page bid (high range)\n' +
    '守山区 塾,"1,900",Medium,45,120,350\n';
  const provider = new CsvKeywordMetricsProvider();
  const { rows, errors } = provider.parse(csv, 'test.csv');
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].average_monthly_searches, 1900);
  assert.equal(rows[0].competition, 'Medium');
  assert.equal(rows[0].competition_index, 45);
  assert.equal(rows[0].source, 'keyword_planner_csv');
});

test('CsvKeywordMetricsProvider: 日本語列名(BOM付きUTF-8)を解析する', () => {
  const csv = '﻿キーワード,月間平均検索ボリューム,競合性\n個別指導 守山区,320,中\n';
  const provider = new CsvKeywordMetricsProvider();
  const { rows } = provider.parse(csv, 'test_ja.csv');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].average_monthly_searches, 320);
  // 正規化ルールにより「個別指導」はそのまま(「個別指導塾」でないため変化しない)
  assert.equal(rows[0].normalized_keyword, '個別指導 守山区');
});

test('CsvKeywordMetricsProvider: 列順が違っても列名一致で正しく解析する', () => {
  const csv = '競合性,キーワード,月間検索数\n低,無料体験 塾,50\n';
  const provider = new CsvKeywordMetricsProvider();
  const { rows } = provider.parse(csv);
  assert.equal(rows[0].keyword, '無料体験 塾');
  assert.equal(rows[0].average_monthly_searches, 50);
  assert.equal(rows[0].competition, '低');
});

test('CsvKeywordMetricsProvider: 欠損値(空欄・ハイフン)はnullとして扱う', () => {
  const csv = 'キーワード,月間検索数\n夏期講習 守山区,\n冬期講習 守山区,--\n';
  const provider = new CsvKeywordMetricsProvider();
  const { rows } = provider.parse(csv);
  assert.equal(rows[0].average_monthly_searches, null);
  assert.equal(rows[1].average_monthly_searches, null);
});

test('CsvKeywordMetricsProvider: キーワード列が空の行はエラーとして記録しスキップする', () => {
  const csv = 'キーワード,月間検索数\n,100\n有効なキーワード,50\n';
  const provider = new CsvKeywordMetricsProvider();
  const { rows, errors, totalRows } = provider.parse(csv);
  assert.equal(totalRows, 2);
  assert.equal(rows.length, 1);
  assert.equal(errors.length, 1);
});
