'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { reiwaToSeireki, seirekiToReiwa, extractYear, extractAllYears, extractYearPreferTitle, formatYearWithEra } = require('../scripts/lib/exam_research/year_normalizer');

test('reiwaToSeireki/seirekiToReiwa: 令和⇔西暦の相互変換', () => {
  assert.equal(reiwaToSeireki(9), 2027);
  assert.equal(seirekiToReiwa(2027), 9);
  assert.equal(reiwaToSeireki(1), 2019);
});

test('extractYear: 各種表記から西暦を抽出する', () => {
  assert.equal(extractYear('令和9年度の入試日程'), 2027);
  assert.equal(extractYear('令和9年について'), 2027);
  assert.equal(extractYear('R9年度実施'), 2027);
  assert.equal(extractYear('R9実施'), 2027);
  assert.equal(extractYear('2027年度の変更点'), 2027);
  assert.equal(extractYear('2027年に実施'), 2027);
  assert.equal(extractYear('とくに年度の記載なし'), null);
});

test('extractAllYears: 複数年度が混在するテキストから全て抽出する(重複除去)', () => {
  const years = extractAllYears('令和8年度の結果を踏まえた令和9年度の変更点。2027年度も参照。');
  assert.deepEqual([...years].sort(), [2026, 2027]);
});

test('extractYearPreferTitle: タイトルに年度があれば本文の年度言及より優先する', () => {
  // 実際のPDF本文には「令和6年度からWeb出願導入」のような過去の制度変更が
  // 混在することがあり、本文の最初のマッチだけでは記事の対象年度と無関係な値を拾ってしまう
  const title = 'R9入学者選抜に関するＱ＆Ａ';
  const body = '令和６（2024）年度入試から、全ての課程でWeb出願を導入しました。';
  assert.equal(extractYearPreferTitle(title, body), 2027);
});

test('extractYearPreferTitle: タイトルに年度が無ければ本文から抽出する', () => {
  assert.equal(extractYearPreferTitle('入学者選抜に関するお知らせ', '令和9年度の変更点'), 2027);
});

test('formatYearWithEra: 表示用フォーマット', () => {
  assert.equal(formatYearWithEra(2027), '2027年度(令和9年度)');
});
