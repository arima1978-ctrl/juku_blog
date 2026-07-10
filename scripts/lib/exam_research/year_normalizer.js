'use strict';

// 年度表記(西暦・令和)を内部形式(西暦の整数)へ正規化する。
// 令和の元年は2019年(令和1年=2019年)。令和N年度 = 2018+N 年。
// 「令和9年度」「令和9年」「R9年度」「R9」「2027年度」「2027年」のいずれも認識する。

const REIWA_OFFSET = 2018; // 令和N年 = 2018 + N

function reiwaToSeireki(reiwaYear) {
  return REIWA_OFFSET + reiwaYear;
}

function seirekiToReiwa(seirekiYear) {
  return seirekiYear - REIWA_OFFSET;
}

// テキストから最初に見つかった年度表記を西暦の整数で返す(見つからなければnull)。
function extractYear(text) {
  if (!text) return null;

  const reiwaMatch = text.match(/令和\s*(\d{1,2})\s*年度?|R\s*(\d{1,2})\s*(?:年度)?/);
  if (reiwaMatch) {
    const n = Number(reiwaMatch[1] || reiwaMatch[2]);
    if (Number.isFinite(n)) return reiwaToSeireki(n);
  }

  const seirekiMatch = text.match(/(20\d{2})\s*年度?/);
  if (seirekiMatch) {
    const n = Number(seirekiMatch[1]);
    if (Number.isFinite(n)) return n;
  }

  return null;
}

// テキスト中に登場する年度表記をすべて西暦の整数で返す(重複除去、出現順)。
function extractAllYears(text) {
  if (!text) return [];
  const years = new Set();

  const reiwaRegex = /令和\s*(\d{1,2})\s*年度?|R\s*(\d{1,2})\s*(?:年度)?/g;
  let m;
  while ((m = reiwaRegex.exec(text))) {
    const n = Number(m[1] || m[2]);
    if (Number.isFinite(n)) years.add(reiwaToSeireki(n));
  }

  const seirekiRegex = /(20\d{2})\s*年度?/g;
  while ((m = seirekiRegex.exec(text))) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) years.add(n);
  }

  return [...years];
}

// 表示用: 西暦の整数から「2027年度(令和9年度)」形式の文字列を作る
function formatYearWithEra(seirekiYear) {
  if (!Number.isFinite(seirekiYear)) return '';
  const reiwa = seirekiToReiwa(seirekiYear);
  return `${seirekiYear}年度(令和${reiwa}年度)`;
}

// タイトル(ファイル名・見出し等)を優先して年度を抽出し、無ければ本文から抽出する。
// 本文には「令和6年度からWeb出願を導入」のような過去の制度変更に関する言及が
// 混在することがあり、単純な最初のマッチでは記事の対象年度と無関係な値を
// 拾ってしまうため、年度が明記されがちなタイトルを優先する。
function extractYearPreferTitle(title, text) {
  return extractYear(title) ?? extractYear(text);
}

module.exports = {
  reiwaToSeireki,
  seirekiToReiwa,
  extractYear,
  extractAllYears,
  extractYearPreferTitle,
  formatYearWithEra,
};
