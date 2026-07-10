'use strict';

// DBに保存されたJSON文字列(fact_check_report/similarity_check/plan_rationale等)を
// パースする共通ヘルパー。パース失敗時は元の文字列を{ raw }で包んで返す(例外を投げない)。
function safeJsonParse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

module.exports = { safeJsonParse };
