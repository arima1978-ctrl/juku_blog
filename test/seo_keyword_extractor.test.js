'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDictionaryEntries, extractKeywordCandidates } = require('../scripts/lib/seo/keyword_extractor');
const { loadJukuConfig } = require('../scripts/lib/config');

const WEIGHTS = { title: 5, h1: 5, h2: 3, h3: 2, meta_description: 2, body: 1 };

const SAMPLE_PAGE = {
  title: '守山区の個別指導塾なら〇〇ゼミ',
  metaDescription: '守山区・小幡エリアで個別指導を行う学習塾です。',
  headings: [
    { level: 'h1', text: '守山区の個別指導塾' },
    { level: 'h2', text: '夏期講習のご案内' },
    { level: 'h3', text: '無料体験のお申込み' },
  ],
  bodyText: '守山区にある個別指導塾です。小1から中3まで対応。夏期講習は毎年好評です。',
};

test('buildDictionaryEntries: config/juku.yamlのarea設定から地域・学校辞書を組み立てる', () => {
  const entries = buildDictionaryEntries(loadJukuConfig());
  assert.ok(entries.some((e) => e.category === 'area' && e.term === '小幡'));
  assert.ok(entries.some((e) => e.category === 'grade' && e.term === '小1'));
  assert.ok(entries.some((e) => e.category === 'subject'));
  assert.ok(entries.some((e) => e.category === 'teaching_style' && e.term === '個別指導'));
  assert.ok(entries.some((e) => e.category === 'exam' && e.term === '夏期講習'));
});

test('extractKeywordCandidates: titleに出現する語は高スコアになる', () => {
  const entries = buildDictionaryEntries(loadJukuConfig());
  const candidates = extractKeywordCandidates(SAMPLE_PAGE, entries, WEIGHTS);
  const moriyama = candidates.find((c) => c.rawKeyword === '守山区');
  assert.ok(moriyama);
  assert.ok(moriyama.occurrences.title >= 1);
  assert.ok(moriyama.score > 0);
});

test('extractKeywordCandidates: 出現しない語は候補に含まれない', () => {
  const entries = buildDictionaryEntries(loadJukuConfig());
  const candidates = extractKeywordCandidates(SAMPLE_PAGE, entries, WEIGHTS);
  assert.ok(!candidates.some((c) => c.rawKeyword === '瓢箪山'));
});

test('extractKeywordCandidates: 除外リストの語(競合ブランド名等)は候補から除く', () => {
  const entries = buildDictionaryEntries(loadJukuConfig());
  const withoutExclusion = extractKeywordCandidates(SAMPLE_PAGE, entries, WEIGHTS);
  assert.ok(withoutExclusion.some((c) => c.rawKeyword === '個別指導'));
  const withExclusion = extractKeywordCandidates(SAMPLE_PAGE, entries, WEIGHTS, ['個別指導']);
  assert.ok(!withExclusion.some((c) => c.rawKeyword === '個別指導'));
});

test('extractKeywordCandidates: スコア降順でソートされる', () => {
  const entries = buildDictionaryEntries(loadJukuConfig());
  const candidates = extractKeywordCandidates(SAMPLE_PAGE, entries, WEIGHTS);
  for (let i = 1; i < candidates.length; i++) {
    assert.ok(candidates[i - 1].score >= candidates[i].score);
  }
});

test('extractKeywordCandidates: normalizedKeywordに正規化ルールが適用される', () => {
  const entries = buildDictionaryEntries(loadJukuConfig());
  const candidates = extractKeywordCandidates(SAMPLE_PAGE, entries, WEIGHTS);
  const grade = candidates.find((c) => c.rawKeyword === '小1');
  assert.ok(grade);
  assert.equal(grade.normalizedKeyword, '小1');
});
