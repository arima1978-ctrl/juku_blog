'use strict';

// Sprint 3.3.1: Supporting Taskが主張するサービス・指導形態・訴求内容が、
// 対象ページの実際の本文(title/headings/bodyExcerpt)に存在するかを決定的に確認する。
// GSC実績は「露出・需要」の指標であり「ページが実際にそのサービスを提供している証拠」
// にはならないため、事実確認には一切使わない(Primary選定でのみ使う)。
// LLM・DB・外部通信は一切行わない(pageContextは呼び出し側が既存page_context_provider.js
// 経由で解決済みのものを渡すこと)。

const { TEACHING_STYLES } = require('./dictionaries');
const { normalizeKeyword } = require('./normalizer');

// V1事実確認専用の同義語辞書(唯一の定義箇所)。
// normalizeKeyword()の個別ルール(個別指導塾→個別指導、無料体験授業→無料体験)で
// 既に吸収される表記はここで重複定義しない(正規化後にそのまま一致するため)。
const SYNONYM_GROUPS = {
  個別指導: ['個別指導', '個別授業'],
  集団指導: ['集団指導', '集団授業', '一斉指導'],
  自立学習: ['自立学習'],
  塾: ['塾', '学習塾'],
  無料体験: ['無料体験', '体験授業', '体験レッスン'],
};

// 排他表現の相互チェックに使う「同一intent family内の他の値」一覧。
// teaching_styleのみ既存dictionaries.jsの正データを再利用する(新規辞書を増やさない)。
const FAMILY_MEMBERS = { teaching_style: TEACHING_STYLES };

// 直接否定(対象語自身の近くにある場合にconflictingとする語句)。
const NEGATION_TERMS = ['ない', 'なし', '未対応', '実施していません', '対応していません'];
// 排他表現(「他の値」の近くにある場合に対象語をconflictingとする語句)。
const EXCLUSIVITY_TERMS = ['のみ'];
const PROXIMITY_WINDOW = 30; // 中心語の前後何文字以内を近接とみなすか

// 事実照合専用の軽量正規化。全角/半角・大小文字・空白/改行を吸収したうえで、
// 既存normalizeKeyword()のSEO向け表記ゆれルール(個別指導塾→個別指導等)も適用する。
// normalizeKeyword自体はキーワード向けだが、その個別ルールは本文照合にも有効なため再利用する。
function normalizeForFactCheck(text) {
  if (!text) return '';
  const collapsed = text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  return normalizeKeyword(collapsed).normalized;
}

function synonymsFor(term) {
  if (!term) return [];
  return SYNONYM_GROUPS[term] || [term];
}

// Task側の中心語(サービス・指導形態・訴求内容)を抽出する。
// keyword_components(既存の候補生成パイプラインが埋めたフィールド)を優先し、
// キーワード文字列の雑な部分一致には依存しない。
function extractServiceTerm(task) {
  const components = task.keywordComponents || {};
  return components.teaching_style || components.service || components.exam || null;
}

// テンプレート種別から「排他チェック対象のfamilyキー」を決める。
// area_teaching_style以外は単独語として扱う(相互排他チェックの対象なし)。
function familyKeyOf(task) {
  return task.templateType === 'area_teaching_style' ? 'teaching_style' : null;
}

// normalizedText内でsynonymsのいずれかが出現する全位置を返す。
function findOccurrences(normalizedText, synonyms) {
  const occurrences = [];
  synonyms.forEach((syn) => {
    const normalizedSyn = normalizeForFactCheck(syn);
    if (!normalizedSyn) return;
    let idx = normalizedText.indexOf(normalizedSyn);
    while (idx !== -1) {
      occurrences.push({ index: idx, length: normalizedSyn.length, term: syn });
      idx = normalizedText.indexOf(normalizedSyn, idx + 1);
    }
  });
  return occurrences;
}

function hasNearbyWord(normalizedText, occurrence, words) {
  const start = Math.max(0, occurrence.index - PROXIMITY_WINDOW);
  const end = Math.min(normalizedText.length, occurrence.index + occurrence.length + PROXIMITY_WINDOW);
  const window = normalizedText.slice(start, end);
  return words.some((w) => window.includes(normalizeForFactCheck(w)));
}

// task: Supporting Task(page_task_grouper.jsの拡張Taskオブジェクトと同じ形。
//   keywordComponents/templateTypeを持つこと)。
// pageContext: page_context_provider.fetchPageContext()等が返す形
//   ({status, title, headings, bodyExcerpt, ...})。
// 戻り値: { status: 'verified'|'unverified'|'conflicting', serviceTerm, matchedTerms,
//           evidenceSources, reason, warnings }
function evaluateSupportingTaskFact(task, pageContext) {
  const serviceTerm = extractServiceTerm(task);
  if (!serviceTerm) {
    return {
      status: 'unverified',
      serviceTerm: null,
      matchedTerms: [],
      evidenceSources: [],
      reason: 'service_term_extraction_failed',
      warnings: ['Taskから中心語(サービス・指導形態・訴求内容)を抽出できませんでした'],
    };
  }

  if (!pageContext || pageContext.status !== 'fetched') {
    return {
      status: 'unverified',
      serviceTerm,
      matchedTerms: [],
      evidenceSources: [],
      reason: 'page_context_not_available',
      warnings: ['対象ページ本文を取得できないため事実確認できません'],
    };
  }

  const sources = {
    title: normalizeForFactCheck(pageContext.title || ''),
    heading: normalizeForFactCheck((pageContext.headings || []).join(' ')),
    body: normalizeForFactCheck(pageContext.bodyExcerpt || ''),
  };

  const targetSynonyms = synonymsFor(serviceTerm);
  const familyKey = familyKeyOf(task);
  const otherFamilyMembers = familyKey ? FAMILY_MEMBERS[familyKey].filter((m) => m !== serviceTerm) : [];

  const matchedTerms = new Set();
  const evidenceSources = new Set();
  let conflicting = false;

  Object.entries(sources).forEach(([sourceName, text]) => {
    if (!text) return;

    // (a) 対象語自身の近くに直接否定 → conflicting
    findOccurrences(text, targetSynonyms).forEach((occ) => {
      matchedTerms.add(occ.term);
      evidenceSources.add(sourceName);
      if (hasNearbyWord(text, occ, NEGATION_TERMS)) conflicting = true;
    });

    // (b) 同一family内の「他の値」の近くに排他表現(のみ) → 対象語側がconflicting
    //     (例: 「個別指導のみ」は集団指導Taskをconflictingにするが、
    //      個別指導Task自身の判定には影響しない)
    otherFamilyMembers.forEach((otherMember) => {
      findOccurrences(text, synonymsFor(otherMember)).forEach((occ) => {
        if (hasNearbyWord(text, occ, EXCLUSIVITY_TERMS)) conflicting = true;
      });
    });
  });

  if (conflicting) {
    return {
      status: 'conflicting',
      serviceTerm,
      matchedTerms: [...matchedTerms],
      evidenceSources: [...evidenceSources],
      reason: 'negation_or_exclusivity_pattern_nearby',
      warnings: [],
    };
  }

  if (matchedTerms.size > 0) {
    return {
      status: 'verified',
      serviceTerm,
      matchedTerms: [...matchedTerms],
      evidenceSources: [...evidenceSources],
      reason: `ページ${[...evidenceSources].join('/')}に${serviceTerm}関連の記載がある`,
      warnings: [],
    };
  }

  return {
    status: 'unverified',
    serviceTerm,
    matchedTerms: [],
    evidenceSources: [],
    reason: 'no_matching_term_in_page_content',
    warnings: [],
  };
}

function evaluateSupportingTasks(tasks, pageContext) {
  return tasks.map((task) => evaluateSupportingTaskFact(task, pageContext));
}

module.exports = {
  evaluateSupportingTaskFact,
  evaluateSupportingTasks,
  extractServiceTerm,
  normalizeForFactCheck,
  SYNONYM_GROUPS,
  FAMILY_MEMBERS,
  NEGATION_TERMS,
  EXCLUSIVITY_TERMS,
  PROXIMITY_WINDOW,
};
