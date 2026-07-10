'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyIsExamRelated, extractTagsFromText } = require('../scripts/lib/exam_research/topic_classifier');

const KEYWORDS = ['愛知県 高校入試', '高校入試', '入学者選抜'];

test('classifyIsExamRelated: キーワード一致で愛知県高校入試関連と判定する', () => {
  const result = classifyIsExamRelated(['愛知県2027年度公立高校入試日程発表', '詳細'], KEYWORDS);
  assert.equal(result.isExamRelated, true);
  assert.ok(result.matchedKeywords.length > 0);
});

test('classifyIsExamRelated: 無関係なテーマはfalseになる', () => {
  const result = classifyIsExamRelated(['夏休み前に確認したい子どもの学習状況', '保護者コラム'], KEYWORDS);
  assert.equal(result.isExamRelated, false);
  assert.deepEqual(result.matchedKeywords, []);
});

test('extractTagsFromText: テーマ文言から用途タグを推定する', () => {
  const tags = extractTagsFromText('学力検査日と募集人員の変更点、推薦選抜の内容');
  assert.ok(tags.includes('exam_schedule'));
  assert.ok(tags.includes('capacity'));
  assert.ok(tags.includes('recommendation'));
});

test('extractTagsFromText: 一致キーワードが無ければ空配列', () => {
  assert.deepEqual(extractTagsFromText('夏休みの過ごし方'), []);
});
