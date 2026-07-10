'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEnabledSources, loadClassificationKeywords, selectSourcesByTags } = require('../scripts/lib/exam_research/source_registry');

test('loadEnabledSources: config/aichi_exam_sources.yamlから有効なソースのみ読み込む', () => {
  const sources = loadEnabledSources();
  assert.ok(sources.length >= 7);
  assert.ok(sources.every((s) => s.enabled !== false));
  assert.ok(sources.some((s) => s.id === 'aichi_board_of_education' && s.tier === 1));
});

test('loadClassificationKeywords: 分類用キーワードを読み込む', () => {
  const keywords = loadClassificationKeywords();
  assert.ok(keywords.includes('高校入試'));
});

test('selectSourcesByTags: tier昇順・タグ一致するソースのみ返す', () => {
  const sources = [
    { id: 'a', tier: 3, tags: ['exam_schedule'] },
    { id: 'b', tier: 1, tags: ['exam_schedule'] },
    { id: 'c', tier: 2, tags: ['target_deviation'] },
  ];
  const result = selectSourcesByTags(sources, ['exam_schedule']);
  assert.deepEqual(result.map((s) => s.id), ['b', 'a']);
});

test('selectSourcesByTags: tagsが空なら全ソースをtier順で返す', () => {
  const sources = [
    { id: 'a', tier: 3, tags: [] },
    { id: 'b', tier: 1, tags: [] },
  ];
  const result = selectSourcesByTags(sources, []);
  assert.deepEqual(result.map((s) => s.id), ['b', 'a']);
});
