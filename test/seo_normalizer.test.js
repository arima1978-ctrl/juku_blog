'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeKeyword } = require('../scripts/lib/seo/normalizer');

test('normalizeKeyword: 学習塾→塾', () => {
  const { normalized, appliedRules } = normalizeKeyword('守山区 学習塾');
  assert.equal(normalized, '守山区 塾');
  assert.ok(appliedRules.includes('gakushu_juku'));
});

test('normalizeKeyword: 個別指導塾→個別指導(学習塾ルールとは別)', () => {
  const { normalized, appliedRules } = normalizeKeyword('個別指導塾 小幡');
  assert.equal(normalized, '個別指導 小幡');
  assert.ok(appliedRules.includes('kobetsu_juku'));
});

test('normalizeKeyword: 名古屋市守山区→守山区', () => {
  const { normalized } = normalizeKeyword('名古屋市守山区の塾');
  assert.equal(normalized, '守山区の塾');
});

test('normalizeKeyword: 小学1年生→小1、小学六年生→小6', () => {
  assert.equal(normalizeKeyword('小学1年生').normalized, '小1');
  assert.equal(normalizeKeyword('小学六年生').normalized, '小6');
});

test('normalizeKeyword: 中学3年生→中3', () => {
  assert.equal(normalizeKeyword('中学3年生').normalized, '中3');
});

test('normalizeKeyword: 高校受験→高校入試、定期試験→定期テスト、無料体験授業→無料体験', () => {
  assert.equal(normalizeKeyword('高校受験対策').normalized, '高校入試対策');
  assert.equal(normalizeKeyword('定期試験対策').normalized, '定期テスト対策');
  assert.equal(normalizeKeyword('無料体験授業のご案内').normalized, '無料体験のご案内');
});

test('normalizeKeyword: 何も一致しなければそのまま返しappliedRulesは空', () => {
  const { normalized, appliedRules } = normalizeKeyword('英会話教室');
  assert.equal(normalized, '英会話教室');
  assert.deepEqual(appliedRules, []);
});

test('normalizeKeyword: 意味の異なる語(英会話)は過度に統合しない', () => {
  // "英会話"に"塾"ルールが誤爆しないことを確認
  const { normalized } = normalizeKeyword('英会話クラブ');
  assert.equal(normalized, '英会話クラブ');
});
