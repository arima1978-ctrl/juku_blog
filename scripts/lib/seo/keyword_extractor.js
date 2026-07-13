'use strict';

// 解析済みページ(title/meta description/H1-H3/本文)から、辞書ベースでキーワード候補を
// 抽出し、config/juku.yamlのextraction_weightsに従って重み付けする。
// 「最初は複雑なAI解析に依存しすぎず辞書+重み付けの組み合わせで行う」という設計方針に基づく
// (形態素解析ライブラリの新規追加はせず、既存のcheerio抽出結果に対する単純な文字列マッチのみ)。

const { normalizeKeyword } = require('./normalizer');
const {
  GRADES,
  SUBJECTS,
  TEACHING_STYLES,
  EXAM_TERMS,
  buildAreaDictionary,
} = require('./dictionaries');

function buildDictionaryEntries(jukuConfig) {
  const area = buildAreaDictionary(jukuConfig);
  const entries = [];
  const push = (category, terms) => (terms || []).filter(Boolean).forEach((term) => entries.push({ term, category }));

  if (area.city) push('area', [area.city]);
  if (area.ward) push('area', [area.ward]);
  push('area', area.neighborhoods);
  push('school', area.elementarySchools);
  push('school', area.juniorHighSchools);
  push('school', area.highSchools);
  push('grade', GRADES);
  push('subject', SUBJECTS);
  push('teaching_style', TEACHING_STYLES);
  push('exam', EXAM_TERMS);

  return entries;
}

function countOccurrences(text, term) {
  if (!text || !term) return 0;
  return text.split(term).length - 1;
}

function buildZoneTexts(page) {
  const headingsByLevel = { h1: [], h2: [], h3: [] };
  (page.headings || []).forEach((h) => {
    if (headingsByLevel[h.level]) headingsByLevel[h.level].push(h.text);
  });
  return {
    title: page.title || '',
    h1: headingsByLevel.h1.join(' '),
    h2: headingsByLevel.h2.join(' '),
    h3: headingsByLevel.h3.join(' '),
    meta_description: page.metaDescription || '',
    body: page.bodyText || '',
  };
}

// weights: { title, h1, h2, h3, meta_description, body } (config/juku.yamlのseo.competitor_analysis.extraction_weights)
// exclusionTerms: 完全一致で除外する語句(競合ブランド名・一般除外語)
function extractKeywordCandidates(page, dictionaryEntries, weights, exclusionTerms = []) {
  const zones = buildZoneTexts(page);
  const exclusionSet = new Set(exclusionTerms);

  const candidates = dictionaryEntries
    .filter((entry) => !exclusionSet.has(entry.term))
    .map((entry) => {
      const occurrences = {};
      let score = 0;
      for (const zoneName of Object.keys(zones)) {
        const count = countOccurrences(zones[zoneName], entry.term);
        if (count > 0) {
          occurrences[zoneName] = count;
          score += count * (weights[zoneName] || 0);
        }
      }
      return { entry, occurrences, score };
    })
    .filter((c) => c.score > 0)
    .map((c) => {
      const { normalized, appliedRules } = normalizeKeyword(c.entry.term);
      const confidence = Math.round(Math.min(1, c.score / 20) * 100) / 100;
      return {
        rawKeyword: c.entry.term,
        normalizedKeyword: normalized,
        normalizationRule: appliedRules[0] || null,
        category: c.entry.category,
        score: c.score,
        occurrences: c.occurrences,
        confidence,
      };
    });

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

module.exports = { buildDictionaryEntries, extractKeywordCandidates };
