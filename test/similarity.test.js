'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { textSimilarity, extractHeadings, checkSimilarity } = require('../scripts/lib/similarity');

test('textSimilarity: 完全一致は1', () => {
  assert.equal(textSimilarity('中学生の夏休みの勉強時間', '中学生の夏休みの勉強時間'), 1);
});

test('textSimilarity: 全く異なる文章は低いスコア', () => {
  const score = textSimilarity('中学生の夏休みの勉強時間について', '英検準2級に合格した話');
  assert.ok(score < 0.3, `score=${score}`);
});

test('textSimilarity: 一部の言い換えは高いスコアになる(重複タイトル判定の想定ケース)', () => {
  const score = textSimilarity(
    '【守山区小幡・瓢箪山の個別指導教室】中学生の夏休みの勉強時間について',
    '【守山区小幡・瓢箪山の個別指導教室】中学生が夏休みに勉強すべき時間について'
  );
  assert.ok(score > 0.6, `score=${score}`);
});

test('extractHeadings: h2/h3のみを抽出しh1やただの本文は含めない', () => {
  const md = [
    '# タイトルではなくh1(通常本文には無い想定)',
    '導入文です。',
    '## 悩みの共感',
    '本文...',
    '### 具体的な対策',
    '本文...',
    '## まとめ',
  ].join('\n');
  assert.equal(extractHeadings(md), '悩みの共感 具体的な対策 まとめ');
});

test('extractHeadings: 見出しが無ければ空文字', () => {
  assert.equal(extractHeadings('見出しのない本文だけです。'), '');
});

test('checkSimilarity: 閾値未満ならis_duplicate=false', () => {
  const candidate = { title: '全く新しいテーマの記事', headingsText: '新しい見出し1 新しい見出し2', body: '新しい本文です。' };
  const pastPosts = [
    { id: 1, title: '過去の別テーマ記事', body_md: '## 過去の見出し\n過去の本文。' },
  ];
  const result = checkSimilarity(candidate, pastPosts);
  assert.equal(result.is_duplicate, false);
  assert.equal(result.matched_post_id, 1);
});

test('checkSimilarity: タイトルがほぼ同じなら閾値超えでis_duplicate=true(見出し類似度判定の想定ケース)', () => {
  const candidate = {
    title: '中学生の夏休みの勉強時間について',
    headingsText: '悩みへの共感 具体的な対策 まとめ',
    body: '中学生の夏休みの勉強時間についての本文です。',
  };
  const pastPosts = [
    {
      id: 42,
      title: '中学生の夏休みの勉強時間',
      body_md: '## 悩みへの共感\n本文\n## 具体的な対策\n本文\n## まとめ\n本文',
    },
  ];
  const result = checkSimilarity(candidate, pastPosts);
  assert.equal(result.is_duplicate, true);
  assert.equal(result.matched_post_id, 42);
  assert.equal(result.matched_title, '中学生の夏休みの勉強時間');
});

test('checkSimilarity: 過去記事が無ければmatched_post_id=nullでis_duplicate=false', () => {
  const result = checkSimilarity({ title: 'x', headingsText: 'y', body: 'z' }, []);
  assert.equal(result.is_duplicate, false);
  assert.equal(result.matched_post_id, null);
});

test('checkSimilarity: 閾値はconfig値で調整できる(厳しい閾値にすると重複判定されにくくなる)', () => {
  const candidate = { title: '中学生の夏休みの勉強時間について', headingsText: '', body: '' };
  const pastPosts = [{ id: 1, title: '中学生の夏休みの勉強時間', body_md: '' }];
  const lenient = checkSimilarity(candidate, pastPosts, { title: 0.5 });
  const strict = checkSimilarity(candidate, pastPosts, { title: 0.99 });
  assert.equal(lenient.is_duplicate, true);
  assert.equal(strict.is_duplicate, false);
});
