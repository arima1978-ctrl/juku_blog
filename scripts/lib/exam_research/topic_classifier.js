'use strict';

// 記事テーマ(早瀬のtopics.json候補や智谷の企画テーマ)が愛知県高校入試関連かを
// 決定的に判定する(LLM不使用)。config/aichi_exam_sources.yamlの
// classification_keywordsのいずれかを含むテキストを「関連あり」とする。

// candidateTexts: 判定対象のテキスト配列(headline/detail/category_hint/weekday_theme等)
function classifyIsExamRelated(candidateTexts, classificationKeywords) {
  const keywords = classificationKeywords || [];
  const joined = (candidateTexts || []).filter(Boolean).join('\n');
  const matchedKeywords = keywords.filter((kw) => joined.includes(kw));
  return {
    isExamRelated: matchedKeywords.length > 0,
    matchedKeywords,
  };
}

// テーマ文言から用途タグを推定する(記事内容に応じてどのソースを優先取得するか決めるため)。
// 単純なキーワード→タグの対応表による決定的マッチング。
const TAG_KEYWORD_MAP = [
  { tag: 'exam_schedule', keywords: ['日程', 'スケジュール', '学力検査日', '合格発表'] },
  { tag: 'selection_system', keywords: ['制度', '選抜'] },
  { tag: 'recommendation', keywords: ['推薦'] },
  { tag: 'special_selection', keywords: ['特色選抜'] },
  { tag: 'general_selection', keywords: ['一般選抜'] },
  { tag: 'interview', keywords: ['面接'] },
  { tag: 'target_deviation', keywords: ['偏差値'] },
  { tag: 'average_score', keywords: ['平均点'] },
  { tag: 'subject_analysis', keywords: ['教科別', '科目別'] },
  { tag: 'application_status', keywords: ['志願', '倍率'] },
  { tag: 'capacity', keywords: ['募集人員', '定員'] },
];

function extractTagsFromText(text) {
  if (!text) return [];
  const tags = new Set();
  for (const { tag, keywords } of TAG_KEYWORD_MAP) {
    if (keywords.some((kw) => text.includes(kw))) tags.add(tag);
  }
  return [...tags];
}

module.exports = { classifyIsExamRelated, extractTagsFromText };
