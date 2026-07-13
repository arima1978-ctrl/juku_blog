'use strict';

// 複合キーワード生成。1ページ分の単語候補(extractKeywordCandidates()の出力)から、
// 「地域×塾」「地域×学年×塾」等のテンプレートに従って複合キーワード候補を作る。
// 無差別な総当たりを避けるため、title/H1/H2のいずれかに出現する語(prominent)
// 同士の組み合わせのみを対象にする(本文にしか出てこない語同士の組み合わせは
// ページ内に大量発生しうるため候補化しない)。
//
// 駅名は現状「地域」辞書(config/juku.yamlのarea.neighborhoods)と同じ語を流用する
// 設計のため(小幡・瓢箪山等は地名と駅名が一致する)、station_juku相当は独立生成せず
// area_juku に統合している(設計案の未確定事項aの既定対応)。

const PROMINENT_ZONES = ['title', 'h1', 'h2'];

// exam辞書の語をテンプレート別のサブタイプへ分類する
const EXAM_SUBTYPES = {
  koko_nyushi: ['高校入試', '高校受験'],
  teiki_test: ['定期テスト'],
  season_course: ['夏期講習', '冬期講習', '春期講習'],
  muryou_taiken: ['無料体験', '体験授業'],
};

function examSubtype(rawKeyword) {
  for (const [subtype, terms] of Object.entries(EXAM_SUBTYPES)) {
    if (terms.includes(rawKeyword)) return subtype;
  }
  return null;
}

function isProminent(candidate) {
  return PROMINENT_ZONES.some((zone) => candidate.occurrences[zone]);
}

function groupByCategory(candidates) {
  const groups = { area: [], school: [], grade: [], subject: [], teaching_style: [], service: [], exam: {} };
  for (const c of candidates.filter(isProminent)) {
    if (c.category === 'exam') {
      const subtype = examSubtype(c.rawKeyword);
      if (!subtype) continue;
      if (!groups.exam[subtype]) groups.exam[subtype] = [];
      groups.exam[subtype].push(c);
    } else if (groups[c.category]) {
      groups[c.category].push(c);
    }
  }
  return groups;
}

// 2語がtitle/H1/H2の同一ゾーンに出現していれば1.0、別ゾーンでも両方prominentなら0.7
function pairCooccurrenceScore(a, b) {
  const sameZone = PROMINENT_ZONES.find((zone) => a.occurrences[zone] && b.occurrences[zone]);
  return { score: sameZone ? 1.0 : 0.7, sameZone: sameZone || null };
}

const SLOT_ORDER = ['area', 'school', 'grade', 'subject', 'teaching_style', 'service', 'exam'];

function buildCompoundKeywordString(components) {
  return SLOT_ORDER.filter((slot) => components[slot]).map((slot) => components[slot]).join(' ');
}

function combine(templateType, slotPicks, results) {
  const entries = Object.entries(slotPicks);
  let worstScore = 1.0;
  let sameZone = null;
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const pair = pairCooccurrenceScore(entries[i][1], entries[j][1]);
      if (pair.score < worstScore) worstScore = pair.score;
      if (pair.sameZone) sameZone = pair.sameZone;
    }
  }
  const components = {};
  entries.forEach(([slot, cand]) => {
    components[slot] = cand.normalizedKeyword;
  });
  results.push({
    compoundKeyword: buildCompoundKeywordString(components),
    templateType,
    components,
    cooccurrenceScore: worstScore,
    sameZone,
  });
}

// candidates: extractKeywordCandidates()の戻り値(1ページ分)
// 戻り値: [{ compoundKeyword, templateType, components, cooccurrenceScore, sameZone }]
function buildCompoundKeywords(candidates) {
  const groups = groupByCategory(candidates);
  const results = [];

  for (const areaCand of groups.area) {
    for (const serviceCand of groups.service) {
      combine('area_juku', { area: areaCand, service: serviceCand }, results);
    }
    for (const gradeCand of groups.grade) {
      for (const serviceCand of groups.service) {
        combine('area_grade_juku', { area: areaCand, grade: gradeCand, service: serviceCand }, results);
      }
    }
    for (const tsCand of groups.teaching_style) {
      combine('area_teaching_style', { area: areaCand, teaching_style: tsCand }, results);
    }
    for (const subjectCand of groups.subject) {
      for (const serviceCand of groups.service) {
        combine('area_subject_juku', { area: areaCand, subject: subjectCand, service: serviceCand }, results);
      }
    }
    (groups.exam.koko_nyushi || []).forEach((c) => combine('area_koko_nyushi', { area: areaCand, exam: c }, results));
    (groups.exam.teiki_test || []).forEach((c) => combine('area_teiki_test', { area: areaCand, exam: c }, results));
    (groups.exam.season_course || []).forEach((c) => combine('area_season_course', { area: areaCand, exam: c }, results));
    (groups.exam.muryou_taiken || []).forEach((c) => combine('area_muryou_taiken', { area: areaCand, exam: c }, results));
  }

  for (const schoolCand of groups.school) {
    (groups.exam.teiki_test || []).forEach((c) => combine('school_teiki_test', { school: schoolCand, exam: c }, results));
    for (const serviceCand of groups.service) {
      combine('school_juku', { school: schoolCand, service: serviceCand }, results);
    }
  }

  return results;
}

module.exports = { buildCompoundKeywords, examSubtype, isProminent };
