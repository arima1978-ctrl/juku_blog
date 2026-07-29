'use strict';

// キーワード文字列を「塾/習い事」の2区分へ分類する決定的処理(LLM不使用)。
// 2026-07-29ユーザー承認: seo_keyword_candidates/seo_tasks/seo_metrics_keyword_snapshots
// のcontent_categoryカラム、および習い事カテゴリ週次スナップショット(生GSCクエリの
// 辞書分類)の両方から共通で使う唯一の分類ロジック。
//
// 判定順序(校舎名・住所等、単体では判定できないキーワードを無理に分類しないため):
//   1. NARAIGOTO_KEYWORDSに一致 → 'naraigoto'(英会話はSUBJECTSにも含まれるが、
//      習い事としての意味合いを優先しnaraigoto判定を先に行う)
//   2. 学年/教科/指導形態/塾の一般語/受験・講習関連語のいずれかに一致 → 'juku'
//   3. どちらにも一致しない → null(無理に分類しない)

const { GRADES, SUBJECTS, TEACHING_STYLES, SERVICE_TERMS, EXAM_TERMS, NARAIGOTO_KEYWORDS } = require('./dictionaries');

const JUKU_SIGNAL_TERMS = [...GRADES, ...SUBJECTS, ...TEACHING_STYLES, ...SERVICE_TERMS, ...EXAM_TERMS];

function classifyContentCategory(keywordText) {
  if (!keywordText) return null;
  if (NARAIGOTO_KEYWORDS.some((term) => keywordText.includes(term))) return 'naraigoto';
  if (JUKU_SIGNAL_TERMS.some((term) => keywordText.includes(term))) return 'juku';
  return null;
}

module.exports = { classifyContentCategory };
