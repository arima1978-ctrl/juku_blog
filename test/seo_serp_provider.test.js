'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SerpProvider, CsvSerpProvider, ManualSerpProvider } = require('../scripts/lib/seo/serp_provider');

test('SerpProvider: 未実装は例外を投げる', async () => {
  const provider = new SerpProvider();
  await assert.rejects(() => provider.fetchResults({}));
});

test('CsvSerpProvider: 順位CSVを解析する', () => {
  const csv = 'キーワード,ドメイン,順位,確認日\n守山区 塾,an-english.com,5,2026-07-01\n';
  const provider = new CsvSerpProvider();
  const { rows, errors } = provider.parse(csv, 'serp.csv');
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].domain, 'an-english.com');
  assert.equal(rows[0].position, 5);
  assert.equal(rows[0].source, 'serp_csv');
});

test('CsvSerpProvider: ドメインが空の行はエラーとしてスキップする', () => {
  const csv = 'キーワード,ドメイン,順位\n守山区 塾,,5\n';
  const provider = new CsvSerpProvider();
  const { rows, errors } = provider.parse(csv);
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
});

test('ManualSerpProvider: 手動入力を正規化する', () => {
  const provider = new ManualSerpProvider();
  const result = provider.normalize({
    keyword: '定期テスト対策 守山区',
    domain: 'competitor.example.com',
    position: '3',
    checked_at: '2026-07-01',
  });
  assert.equal(result.normalized_keyword, '定期テスト対策 守山区');
  assert.equal(result.position, 3);
  assert.equal(result.source, 'manual');
});
