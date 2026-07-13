'use strict';

// CSV列名の日本語・英語表記揺れ・列順違いを吸収するためのヘルパー。
// キーワードプランナー等の出力は列名・列順がロケール/バージョンで変わるため、
// 位置ではなく列名のエイリアス一致で値を拾う。

function normalizeHeader(header) {
  return (header || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s　]+/g, ''); // 半角・全角スペース除去
}

// aliasesは表記揺れの候補配列(そのまま比較。normalizeHeaderと同じ正規化をして渡すこと)
function findColumnValue(row, aliases) {
  const normalizedAliases = aliases.map(normalizeHeader);
  for (const key of Object.keys(row)) {
    if (normalizedAliases.includes(normalizeHeader(key))) {
      return row[key];
    }
  }
  return undefined;
}

// カンマ区切りの数値("1,900" 等)・空欄・不正値に対応する数値パース。
// 解析できなければnull(0とは区別する)。
function parseNumber(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (trimmed === '' || trimmed === '-' || trimmed === '--') return null;
  const cleaned = trimmed.replace(/,/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

module.exports = { normalizeHeader, findColumnValue, parseNumber };
