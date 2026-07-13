'use strict';

// キーワードの表記揺れ正規化。意味が異なるものを過度に統合しないよう、
// ユーザー提示の具体例に基づく明示的なルールのみを適用する(あいまいなステミングはしない)。
// raw_keyword(正規化前)は常に呼び出し側で保持すること(normalizeKeywordは正規化後の文字列のみ返す)。

const KANJI_DIGITS = { 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6' };

function kanjiToDigit(s) {
  return KANJI_DIGITS[s] || s;
}

// 適用順が結果を左右するため配列で管理する(具体的なルールを先に、汎用ルールを後に)。
const RULES = [
  { id: 'strip_nagoya_city_prefix', pattern: /名古屋市([一-龥]{1,3}区)/g, replace: (_, ward) => ward },
  { id: 'elementary_grade', pattern: /小学([1-6一二三四五六])年生?/g, replace: (_, n) => `小${kanjiToDigit(n)}` },
  { id: 'junior_high_grade', pattern: /中学([1-3一二三])年生?/g, replace: (_, n) => `中${kanjiToDigit(n)}` },
  { id: 'kobetsu_juku', pattern: /個別指導塾/g, replace: () => '個別指導' },
  { id: 'gakushu_juku', pattern: /学習塾/g, replace: () => '塾' },
  { id: 'koko_jyuken', pattern: /高校受験/g, replace: () => '高校入試' },
  { id: 'teiki_shiken', pattern: /定期試験/g, replace: () => '定期テスト' },
  { id: 'muryou_taiken_jugyou', pattern: /無料体験授業/g, replace: () => '無料体験' },
];

// 正規化とその過程で適用されたルールIDを返す({normalized, appliedRules})。
// 何も適用されなければ appliedRules は空配列、normalized は raw のまま。
function normalizeKeyword(rawKeyword) {
  let normalized = rawKeyword;
  const appliedRules = [];
  for (const rule of RULES) {
    const before = normalized;
    normalized = normalized.replace(rule.pattern, rule.replace);
    if (normalized !== before) appliedRules.push(rule.id);
  }
  return { normalized, appliedRules };
}

module.exports = { normalizeKeyword };
