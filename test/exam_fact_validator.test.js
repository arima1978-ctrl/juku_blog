'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateExamFacts } = require('../scripts/lib/exam_research/fact_validator');

const SOURCES = [
  { id: 'aichi_board_of_education', tier: 1, base_url: 'https://www.pref.aichi.jp/' },
  { id: 'sanaru_aichi_exam_info', tier: 2, base_url: 'https://www.sanaru-net.com/' },
];

test('validateExamFacts: 年度一致・出典有効な事実はpassedになる', () => {
  const facts = [
    {
      fact_id: 'fact-001',
      fact_type: 'exam_schedule',
      label: '学力検査日',
      value: '2027年2月X日',
      target_year: 2027,
      is_official: true,
      source_tier: 1,
      source_url: 'https://www.pref.aichi.jp/soshiki/kotogakko/0000027366.html',
    },
  ];
  const result = validateExamFacts({ facts, articleTargetYear: 2027, registeredSources: SOURCES, bodyText: '本文' });
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.errors, []);
});

test('validateExamFacts: 記事対象年度と事実の年度が異なればYEAR_MISMATCHでblocked', () => {
  const facts = [
    { fact_id: 'fact-001', fact_type: 'exam_schedule', label: '学力検査日', value: 'x', target_year: 2026, is_official: true, source_tier: 1, source_url: 'https://www.pref.aichi.jp/x.html' },
  ];
  const result = validateExamFacts({ facts, articleTargetYear: 2027, registeredSources: SOURCES, bodyText: '' });
  assert.equal(result.status, 'blocked');
  assert.ok(result.errors.some((e) => e.code === 'YEAR_MISMATCH'));
});

test('validateExamFacts: comparison_year明示時は年度不一致でもブロックしない', () => {
  const facts = [
    { fact_id: 'fact-001', fact_type: 'average_score', label: '平均点', value: '60点', target_year: 2026, comparison_year: true, is_official: false, source_tier: 2, source_url: 'https://www.sanaru-net.com/x' },
  ];
  const result = validateExamFacts({ facts, articleTargetYear: 2027, registeredSources: SOURCES, bodyText: '' });
  assert.equal(result.errors.some((e) => e.code === 'YEAR_MISMATCH'), false);
});

test('validateExamFacts: 数値に出典URLが無いとMISSING_SOURCE_FOR_NUMBERでblocked', () => {
  const facts = [
    { fact_id: 'fact-001', fact_type: 'capacity', label: '募集人員', value: '320', value_number: 320, target_year: 2027, is_official: true, source_tier: 1, source_url: null },
  ];
  const result = validateExamFacts({ facts, articleTargetYear: 2027, registeredSources: SOURCES, bodyText: '' });
  assert.equal(result.status, 'blocked');
  assert.ok(result.errors.some((e) => e.code === 'MISSING_SOURCE_FOR_NUMBER'));
});

test('validateExamFacts: 登録ソース外のドメインはINVALID_SOURCE_DOMAINでblocked', () => {
  const facts = [
    { fact_id: 'fact-001', fact_type: 'exam_schedule', label: '日程', value: 'x', target_year: 2027, is_official: true, source_tier: 1, source_url: 'https://evil.example.com/x' },
  ];
  const result = validateExamFacts({ facts, articleTargetYear: 2027, registeredSources: SOURCES, bodyText: '' });
  assert.equal(result.status, 'blocked');
  assert.ok(result.errors.some((e) => e.code === 'INVALID_SOURCE_DOMAIN'));
});

test('validateExamFacts: Tier2/3をis_official=trueにするとUNVERIFIED_OFFICIAL_NUMBERでblocked', () => {
  const facts = [
    { fact_id: 'fact-001', fact_type: 'target_deviation', label: '偏差値', value: '60', target_year: 2027, is_official: true, source_tier: 2, source_url: 'https://www.sanaru-net.com/x' },
  ];
  const result = validateExamFacts({ facts, articleTargetYear: 2027, registeredSources: SOURCES, bodyText: '' });
  assert.equal(result.status, 'blocked');
  assert.ok(result.errors.some((e) => e.code === 'UNVERIFIED_OFFICIAL_NUMBER'));
});

test('validateExamFacts: 同一fact_type+label+年度で異なる値があるとCONFLICTING_FACTSでblocked', () => {
  const facts = [
    { fact_id: 'fact-001', fact_type: 'capacity', label: '募集人員', value: '320', target_year: 2027, is_official: true, source_tier: 1, source_url: 'https://www.pref.aichi.jp/a.html' },
    { fact_id: 'fact-002', fact_type: 'capacity', label: '募集人員', value: '360', target_year: 2027, is_official: true, source_tier: 1, source_url: 'https://www.pref.aichi.jp/b.html' },
  ];
  const result = validateExamFacts({ facts, articleTargetYear: 2027, registeredSources: SOURCES, bodyText: '' });
  assert.equal(result.status, 'blocked');
  assert.ok(result.errors.some((e) => e.code === 'CONFLICTING_FACTS'));
});

test('validateExamFacts: Tier2/3数値がヘッジ表現無しに本文で使われるとwarning', () => {
  const facts = [
    { fact_id: 'fact-001', fact_type: 'target_deviation', label: '偏差値', value: '60', target_year: 2027, is_official: false, source_tier: 2, source_url: 'https://www.sanaru-net.com/x' },
  ];
  const bodyText = '旭野高校に合格するためには偏差値60が必要です。';
  const result = validateExamFacts({ facts, articleTargetYear: 2027, registeredSources: SOURCES, bodyText });
  assert.equal(result.status, 'warning');
  assert.ok(result.warnings.some((w) => w.code === 'TIER_23_STATED_AS_OFFICIAL_LIKE'));
});

test('validateExamFacts: ヘッジ表現があればwarningにならない', () => {
  const facts = [
    { fact_id: 'fact-001', fact_type: 'target_deviation', label: '偏差値', value: '60', target_year: 2027, is_official: false, source_tier: 2, source_url: 'https://www.sanaru-net.com/x' },
  ];
  const bodyText = '模試会社のデータでは偏差値60が目安として紹介されることがあります。';
  const result = validateExamFacts({ facts, articleTargetYear: 2027, registeredSources: SOURCES, bodyText });
  assert.equal(result.status, 'passed');
});
