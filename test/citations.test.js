'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractIds, nextId, validateCitations } = require('../scripts/lib/citations');

test('extractIds: 未使用・使用済み両方のIDを抽出する', () => {
  const raw = [
    '- [ ] [EP-001] 未使用のエピソード',
    '- [x] [EP-002] 使用済みのエピソード(used: 2026-07-01, post: some-slug)',
    '普通の説明文(IDなし)',
  ].join('\n');
  assert.deepEqual(extractIds(raw, 'EP'), ['EP-001', 'EP-002']);
});

test('extractIds: 該当プレフィックスが無ければ空配列', () => {
  assert.deepEqual(extractIds('- [ ] [QA-001] 質問', 'EP'), []);
});

test('extractIds: HTMLコメント内の記載例(実在しない)は抽出しない', () => {
  const raw = [
    '<!-- 例:',
    '- [ ] [QA-999] Q: これは記載例であって実在の素材ではない',
    '      A: 回答例',
    '-->',
    '',
    '- [ ] [QA-001] パターン: 実在する素材',
    '      要点: 実際の回答',
  ].join('\n');
  assert.deepEqual(extractIds(raw, 'QA'), ['QA-001']);
});

test('nextId: 既存が無ければ001から始まる', () => {
  assert.equal(nextId([], 'EP'), 'EP-001');
});

test('nextId: 既存の最大値の次の番号になる', () => {
  assert.equal(nextId(['EP-001', 'EP-003', 'EP-002'], 'EP'), 'EP-004');
});

test('validateCitations: すべて実在すればok', () => {
  const result = validateCitations(
    { episodeSources: ['EP-001'], parentQaSources: ['QA-002'] },
    { episodeIds: ['EP-001', 'EP-002'], parentQaIds: ['QA-001', 'QA-002'] }
  );
  assert.equal(result.ok, true);
});

test('validateCitations: 存在しないIDがあればngで一覧に含まれる', () => {
  const result = validateCitations(
    { episodeSources: ['EP-999'], parentQaSources: ['QA-002'] },
    { episodeIds: ['EP-001'], parentQaIds: ['QA-001', 'QA-002'] }
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.invalidEpisodeIds, ['EP-999']);
  assert.deepEqual(result.invalidParentQaIds, []);
});

test('validateCitations: 出典を使っていない記事(空配列)はok', () => {
  const result = validateCitations({ episodeSources: [], parentQaSources: [] }, { episodeIds: [], parentQaIds: [] });
  assert.equal(result.ok, true);
});
