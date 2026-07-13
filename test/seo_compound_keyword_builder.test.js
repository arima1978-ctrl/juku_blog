'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCompoundKeywords, examSubtype, isProminent } = require('../scripts/lib/seo/compound_keyword_builder');

function candidate({ rawKeyword, normalizedKeyword, category, occurrences }) {
  return { rawKeyword, normalizedKeyword: normalizedKeyword || rawKeyword, category, occurrences, score: 1, confidence: 0.5 };
}

test('examSubtype: exam語をサブタイプへ分類する', () => {
  assert.equal(examSubtype('高校入試'), 'koko_nyushi');
  assert.equal(examSubtype('高校受験'), 'koko_nyushi');
  assert.equal(examSubtype('定期テスト'), 'teiki_test');
  assert.equal(examSubtype('夏期講習'), 'season_course');
  assert.equal(examSubtype('無料体験'), 'muryou_taiken');
  assert.equal(examSubtype('内申点'), null);
});

test('isProminent: title/h1/h2のいずれかに出現すればtrue', () => {
  assert.equal(isProminent(candidate({ rawKeyword: 'x', category: 'area', occurrences: { title: 1 } })), true);
  assert.equal(isProminent(candidate({ rawKeyword: 'x', category: 'area', occurrences: { body: 3 } })), false);
});

test('buildCompoundKeywords: area×service(同一ゾーン)でarea_jukuを生成しスコア1.0', () => {
  const candidates = [
    candidate({ rawKeyword: '小幡', category: 'area', occurrences: { title: 1 } }),
    candidate({ rawKeyword: '塾', category: 'service', occurrences: { title: 1 } }),
  ];
  const results = buildCompoundKeywords(candidates);
  const areaJuku = results.find((r) => r.templateType === 'area_juku');
  assert.ok(areaJuku);
  assert.equal(areaJuku.compoundKeyword, '小幡 塾');
  assert.equal(areaJuku.cooccurrenceScore, 1.0);
  assert.equal(areaJuku.sameZone, 'title');
});

test('buildCompoundKeywords: 別ゾーンでもprominentならスコア0.7で生成される', () => {
  const candidates = [
    candidate({ rawKeyword: '小幡', category: 'area', occurrences: { title: 1 } }),
    candidate({ rawKeyword: '塾', category: 'service', occurrences: { h1: 1 } }),
  ];
  const results = buildCompoundKeywords(candidates);
  const areaJuku = results.find((r) => r.templateType === 'area_juku');
  assert.equal(areaJuku.cooccurrenceScore, 0.7);
  assert.equal(areaJuku.sameZone, null);
});

test('buildCompoundKeywords: 本文にしか出現しない語同士は候補化しない', () => {
  const candidates = [
    candidate({ rawKeyword: '小幡', category: 'area', occurrences: { body: 5 } }),
    candidate({ rawKeyword: '塾', category: 'service', occurrences: { body: 3 } }),
  ];
  const results = buildCompoundKeywords(candidates);
  assert.equal(results.length, 0);
});

test('buildCompoundKeywords: area_grade_juku(3スロット)を生成する', () => {
  const candidates = [
    candidate({ rawKeyword: '守山区', category: 'area', occurrences: { title: 1 } }),
    candidate({ rawKeyword: '小6', category: 'grade', occurrences: { title: 1 } }),
    candidate({ rawKeyword: '塾', category: 'service', occurrences: { h1: 1 } }),
  ];
  const results = buildCompoundKeywords(candidates);
  const r = results.find((x) => x.templateType === 'area_grade_juku');
  assert.ok(r);
  assert.equal(r.compoundKeyword, '守山区 小6 塾');
  assert.equal(r.cooccurrenceScore, 0.7); // 小6とservice(塾)が別ゾーンのため頭打ち
});

test('buildCompoundKeywords: area×高校入試でarea_koko_nyushiを生成する', () => {
  const candidates = [
    candidate({ rawKeyword: '小幡', category: 'area', occurrences: { title: 1 } }),
    candidate({ rawKeyword: '高校入試', category: 'exam', occurrences: { title: 1 } }),
  ];
  const results = buildCompoundKeywords(candidates);
  assert.ok(results.some((r) => r.templateType === 'area_koko_nyushi' && r.compoundKeyword === '小幡 高校入試'));
});

test('buildCompoundKeywords: school×定期テストでschool_teiki_testを生成する', () => {
  const candidates = [
    candidate({ rawKeyword: '守山中学校', category: 'school', occurrences: { h1: 1 } }),
    candidate({ rawKeyword: '定期テスト', category: 'exam', occurrences: { h1: 1 } }),
  ];
  const results = buildCompoundKeywords(candidates);
  assert.ok(results.some((r) => r.templateType === 'school_teiki_test'));
});

test('buildCompoundKeywords: スロットが1つでも欠ければ生成しない(教科のみ・地域無し)', () => {
  const candidates = [candidate({ rawKeyword: '英語', category: 'subject', occurrences: { title: 1 } })];
  const results = buildCompoundKeywords(candidates);
  assert.equal(results.length, 0);
});

test('buildCompoundKeywords: 複数areaに対してテンプレートごとに個別生成される(組み合わせ爆発しないことの確認)', () => {
  const candidates = [
    candidate({ rawKeyword: '小幡', category: 'area', occurrences: { title: 1 } }),
    candidate({ rawKeyword: '守山区', category: 'area', occurrences: { h1: 1 } }),
    candidate({ rawKeyword: '塾', category: 'service', occurrences: { title: 1 } }),
  ];
  const results = buildCompoundKeywords(candidates);
  const areaJukuResults = results.filter((r) => r.templateType === 'area_juku');
  assert.equal(areaJukuResults.length, 2); // 小幡×塾、守山区×塾の2件のみ(教科・学年等が無いため他テンプレートは生成されない)
});
