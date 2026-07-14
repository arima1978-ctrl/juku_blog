'use strict';

const { evaluateSupportingTaskFact } = require('./supporting_task_fact_checker');

// Sprint 3.3: 同一ページを対象とする複数SEO Taskを、決定的ルールのみで
// ページ単位にグループ化し、Primary/Supporting/Excludedへ分類する(調査目的のdry-run専用)。
// LLM呼び出し・DB書き込み・Task status変更は一切行わない純粋関数のみで構成する。
// 呼び出し側(scripts/seo_page_task_group_preview.js)が、DBから読んだTask+候補+GSC実績を
// あらかじめ1つのオブジェクトへ解決してから渡すこと(既存draft_generator.jsの
// {task, candidate, gscMetrics}パターンを踏襲)。

// V1のグルーピング対象。create_article(target_url=nullが前提)は「まだページが存在しない
// 記事企画」であり、ページ単位グルーピングの対象外とする(意図的な設計判断)。
const GROUPABLE_TASK_TYPE = 'improve_school_page';
const GROUPABLE_STATUS = 'proposed';

// gap_classifier.jsの意味と整合させた優先順位(数値が小さいほど優先度が高い)。
// weak/shared: 自社に何らかの検索実績があり改善余地がある(既にページがこの意図を
//   ある程度獲得している証拠がある)。missing/untapped: 自社に実績が無い。
// content_gap: テーマ単位候補(個別キーワード一致ではない)。strong: 既に良好で改善不要。
const GAP_TYPE_PRIORITY = { weak: 0, shared: 1, missing: 2, untapped: 3, content_gap: 4, strong: 5 };
const UNKNOWN_GAP_TYPE_RANK = 6; // 未知/null のgap_typeは最下位扱い(推測で優遇しない)

const GENERAL_SERVICE_INTENT = 'general_service';

// search_intentの組み合わせ判定(決定的マッピングのみ。LLM判断は行わない)。
// キーはPrimary側のsearch_intent。値は他Task側のsearch_intent → 分類カテゴリ。
// 未定義の組み合わせはincompatible_intent(安全側)にフォールバックする。
const INTENT_COMPATIBILITY = {
  general_service: {
    general_service: 'same_section_intent',
    trial_inquiry: 'separate_section_intent',
    exam_prep: 'incompatible_intent',
    seasonal_course: 'separate_section_intent',
  },
};

function gapTypeRank(gapType) {
  return Object.prototype.hasOwnProperty.call(GAP_TYPE_PRIORITY, gapType) ? GAP_TYPE_PRIORITY[gapType] : UNKNOWN_GAP_TYPE_RANK;
}

// ページ単位グルーピングの対象条件。1つでも欠けばungroupedへ回す(理由付き)。
function checkEligibility(task) {
  if (task.status !== GROUPABLE_STATUS) return 'not_proposed';
  if (task.taskType !== GROUPABLE_TASK_TYPE) return 'not_improve_school_page';
  if (!task.targetPageType) return 'missing_target_page_type';
  if (!task.targetPageId) return 'missing_target_page_id';
  if (!task.targetUrl) return 'missing_target_url';
  return null;
}

// Primary Task選定の比較基準(先頭ほど優先)。
//   1. data_confidence降順(nullは0)
//   2. GSC impressions降順(null/データ無しは0) — 既存データのみで判定できる
//      「ページが現在最も強く獲得している検索実績」を表す指標として、
//      data_confidence・gap_typeが同点の場合のtie-breakに用いる。
//   3. gap_type優先順位(weak > shared > missing > untapped > content_gap > strong)
//   4. opportunity_score降順
//   5. task_id昇順(最終的な決定的tie-break)
function comparePrimaryCandidates(a, b) {
  const confA = a.dataConfidence ?? 0;
  const confB = b.dataConfidence ?? 0;
  if (confA !== confB) return confB - confA;

  const impA = a.gscImpressions ?? 0;
  const impB = b.gscImpressions ?? 0;
  if (impA !== impB) return impB - impA;

  const rankA = gapTypeRank(a.gapType);
  const rankB = gapTypeRank(b.gapType);
  if (rankA !== rankB) return rankA - rankB;

  if (a.opportunityScore !== b.opportunityScore) return b.opportunityScore - a.opportunityScore;

  return a.taskId - b.taskId;
}

// Supporting候補内の「近似intent family」代表選定の比較基準。
//   1. data_confidence降順(nullは0)
//   2. opportunity_score降順
//   3. GSC impressions降順(null/データ無しは0)
//   4. task_id昇順(最終tie-break)
function compareRepresentativeCandidates(a, b) {
  const confA = a.dataConfidence ?? 0;
  const confB = b.dataConfidence ?? 0;
  if (confA !== confB) return confB - confA;

  if (a.opportunityScore !== b.opportunityScore) return b.opportunityScore - a.opportunityScore;

  const impA = a.gscImpressions ?? 0;
  const impB = b.gscImpressions ?? 0;
  if (impA !== impB) return impB - impA;

  return a.taskId - b.taskId;
}

// 同一グループ内でPrimary候補を選ぶ。general_serviceを優先プールとし、
// 存在しなければ全Taskへフォールバックする(その旨をwarningsへ記録)。
function selectPrimaryTask(tasks, warnings) {
  if (tasks.length === 0) return null;

  let pool = tasks.filter((t) => t.searchIntent === GENERAL_SERVICE_INTENT);
  if (pool.length === 0) {
    warnings.push({ type: 'no_general_service_task', message: 'general_serviceのTaskが無いため、全Taskからprimaryを選定しました' });
    pool = tasks;
  }

  return [...pool].sort(comparePrimaryCandidates)[0];
}

// search_intentのペアを分類する。primaryIntent/otherIntentのいずれかが欠けている、
// または未定義の組み合わせの場合はincompatible_intentへ安全側フォールバックする。
function classifyIntentPair(primaryIntent, otherIntent) {
  if (!primaryIntent || !otherIntent) {
    return { category: 'incompatible_intent', unknown: true };
  }
  if (primaryIntent === otherIntent) {
    return { category: 'same_section_intent' };
  }
  const row = INTENT_COMPATIBILITY[primaryIntent];
  if (row && row[otherIntent]) {
    return { category: row[otherIntent] };
  }
  return { category: 'incompatible_intent', unknown: true };
}

// 近似Task(同一intent family)の代表選定に使うfamilyキー。
// 既存のtemplate_type/keyword_componentsをそのまま利用し、新規辞書は追加しない。
//   area_juku            → そのままfamily("塾"のみのため単一family)
//   area_muryou_taiken    → そのままfamily(「無料体験」「体験授業」は表記違いの同一意図として統合)
//   area_teaching_style   → teaching_style値ごとに分ける(個別指導と集団指導は別サービスのため統合しない)
//   その他/未設定         → キーワード自体をfamilyとする(統合対象なしの扱い)
function deriveIntentFamily(task) {
  if (task.templateType === 'area_teaching_style') {
    const style = task.keywordComponents && task.keywordComponents.teaching_style;
    return `teaching_style:${style || 'unknown'}`;
  }
  if (task.templateType) return task.templateType;
  return `keyword:${task.targetKeyword}`;
}

function toDisplayTask(task) {
  return {
    taskId: task.taskId,
    targetKeyword: task.targetKeyword,
    searchIntent: task.searchIntent,
    gapType: task.gapType,
    opportunityScore: task.opportunityScore,
    dataConfidence: task.dataConfidence,
    ...(task.factStatus ? { factStatus: task.factStatus, factEvidence: task.factEvidence } : {}),
    ...(task.warnings && task.warnings.length > 0 ? { warnings: task.warnings } : {}),
  };
}

// Supporting Taskの事実確認(Sprint 3.3.1)は、既存の分類ロジックとは責務を分離し、
// supporting_task_fact_checker.jsへ委譲する(このファイルはPrimary/Supporting/Excluded
// の骨格分類のみを担当し、ページ本文の解釈には一切踏み込まない)。
// GSC実績は「需要・露出」の指標でしかなく「ページが実際にそのサービスを提供している証拠」
// にはならないため、事実確認には使わない(Primary選定でのみ使用する)。

// tasks: 呼び出し側で解決済みの拡張Task配列。各要素は以下を持つこと:
//   { taskId, status, taskType, targetUrl, targetPageType, targetPageId, targetPageName,
//     targetKeyword, opportunityScore, sourceCandidateId,
//     gapType, dataConfidence, searchIntent, templateType, keywordComponents,
//     gscImpressions, gscAvgPosition }
// 戻り値: { groups: [...], ungrouped: [...], warnings: [...] } (DB書き込み・LLM呼び出しなし)
function groupTasksByPage(tasks) {
  const ungrouped = [];
  const byGroupKey = new Map();

  for (const task of tasks) {
    const ineligibleReason = checkEligibility(task);
    if (ineligibleReason) {
      ungrouped.push({ taskId: task.taskId, targetKeyword: task.targetKeyword, reason: ineligibleReason });
      continue;
    }
    const groupKey = `${task.targetPageType}:${task.targetPageId}`;
    if (!byGroupKey.has(groupKey)) byGroupKey.set(groupKey, []);
    byGroupKey.get(groupKey).push(task);
  }

  const groups = [];
  const sortedGroupKeys = [...byGroupKey.keys()].sort();

  for (const groupKey of sortedGroupKeys) {
    const groupTasks = byGroupKey.get(groupKey);
    const warnings = [];

    // target_urlの表記揺れ・不一致チェック。勝手にどれか1つへ統合せず、
    // 不一致の場合はtargetUrlをnullにしてwarningへ明記する。
    const distinctUrls = [...new Set(groupTasks.map((t) => t.targetUrl))];
    let targetUrl = distinctUrls[0];
    if (distinctUrls.length > 1) {
      targetUrl = null;
      warnings.push({ type: 'target_url_mismatch', urls: distinctUrls, taskIds: groupTasks.map((t) => t.taskId) });
    }

    const nullConfidenceTasks = groupTasks.filter((t) => t.dataConfidence == null);
    if (nullConfidenceTasks.length > 0) {
      warnings.push({ type: 'data_confidence_null', taskIds: nullConfidenceTasks.map((t) => t.taskId) });
    }

    const primaryTask = selectPrimaryTask(groupTasks, warnings);

    const base = {
      groupKey,
      targetPageType: groupTasks[0].targetPageType,
      targetPageId: groupTasks[0].targetPageId,
      targetPageName: groupTasks[0].targetPageName,
      targetUrl,
      tasks: groupTasks,
    };

    if (!primaryTask) {
      warnings.push({ type: 'no_primary_candidate' });
      groups.push({ ...base, primaryTask: null, supportingTasks: [], excludedTasks: [], warnings });
      continue;
    }

    // Primary自身も1つのintent familyの代表として扱う。同じfamilyの他Taskは
    // Supportingへ残さず、Primaryをduplicate_intentの参照先としてExcludedへ回す
    // (1 Page Groupにつき1 intent familyの代表は最大1件、という確定ルール)。
    const primaryFamily = deriveIntentFamily(primaryTask);

    const others = groupTasks.filter((t) => t.taskId !== primaryTask.taskId);
    const excludedTasks = [];
    const candidatesByFamily = new Map();

    for (const task of others) {
      const { category, unknown } = classifyIntentPair(primaryTask.searchIntent, task.searchIntent);
      if (unknown) {
        warnings.push({ type: 'unknown_search_intent', taskId: task.taskId, searchIntent: task.searchIntent });
      }
      if (category !== 'same_section_intent' && category !== 'compatible_intent') {
        excludedTasks.push({ taskId: task.taskId, targetKeyword: task.targetKeyword, reason: category });
        continue;
      }

      const family = deriveIntentFamily(task);
      if (family === primaryFamily) {
        excludedTasks.push({
          taskId: task.taskId,
          targetKeyword: task.targetKeyword,
          reason: 'duplicate_intent',
          duplicateOf: primaryTask.taskId,
          intentFamily: family,
        });
        continue;
      }

      if (!candidatesByFamily.has(family)) candidatesByFamily.set(family, []);
      candidatesByFamily.get(family).push(task);
    }

    const supportingTasks = [];
    for (const [family, candidates] of candidatesByFamily) {
      const sorted = [...candidates].sort(compareRepresentativeCandidates);
      const representative = sorted[0];
      supportingTasks.push(representative);

      sorted.slice(1).forEach((dup) => {
        excludedTasks.push({
          taskId: dup.taskId,
          targetKeyword: dup.targetKeyword,
          reason: 'duplicate_intent',
          duplicateOf: representative.taskId,
          intentFamily: family,
        });
      });
    }

    if (supportingTasks.length === 0) {
      warnings.push({ type: 'no_supporting_tasks' });
    }

    groups.push({ ...base, primaryTask, supportingTasks, excludedTasks, warnings });
  }

  const topWarnings = [];
  groups.forEach((g) => {
    g.warnings.forEach((w) => topWarnings.push({ groupKey: g.groupKey, ...w }));
  });

  return { groups, ungrouped, warnings: topWarnings };
}

// Sprint 3.3.1: groupTasksByPage()が確定させたSupporting Taskについて、
// ページ本文による事実確認(verified/unverified/conflicting)を適用する。
// 既存のPrimary/duplicate_intent/separate_section_intent等の分類には一切触れず
// (fact checkは常にその後段の最終フィルタとして動く)、Supporting/Excludedの
// 内訳のみを更新した新しいグループオブジェクトを返す(非破壊)。
// Primary Taskは対象外(このモジュールの目的はSupportingを統合Draftへ含めてよいかの確認)。
function applySupportingFactChecks(group, pageContext, { factChecker = evaluateSupportingTaskFact } = {}) {
  const evaluate = factChecker;

  const newSupportingTasks = [];
  const newExcludedTasks = [...group.excludedTasks];
  const warnings = [...group.warnings];

  group.supportingTasks.forEach((task) => {
    const fact = evaluate(task, pageContext);
    const factEvidence = { serviceTerm: fact.serviceTerm, matchedTerms: fact.matchedTerms, evidenceSources: fact.evidenceSources };

    if (fact.status === 'verified') {
      newSupportingTasks.push({ ...task, factStatus: 'verified', factEvidence });
      return;
    }

    const reason = fact.status === 'conflicting' ? 'supporting_fact_conflicting' : 'supporting_fact_unverified';
    newExcludedTasks.push({
      taskId: task.taskId,
      targetKeyword: task.targetKeyword,
      reason,
      factStatus: fact.status,
      factEvidence,
      factReason: fact.reason,
    });
    warnings.push({ type: reason, taskId: task.taskId, targetKeyword: task.targetKeyword, factReason: fact.reason });
  });

  if (group.primaryTask && group.supportingTasks.length > 0 && newSupportingTasks.length === 0) {
    warnings.push({ type: 'no_supporting_tasks_after_fact_check' });
  }

  return { ...group, supportingTasks: newSupportingTasks, excludedTasks: newExcludedTasks, warnings };
}

module.exports = {
  groupTasksByPage,
  applySupportingFactChecks,
  checkEligibility,
  selectPrimaryTask,
  classifyIntentPair,
  deriveIntentFamily,
  comparePrimaryCandidates,
  compareRepresentativeCandidates,
  toDisplayTask,
  gapTypeRank,
  GROUPABLE_TASK_TYPE,
  GROUPABLE_STATUS,
  GAP_TYPE_PRIORITY,
  UNKNOWN_GAP_TYPE_RANK,
  GENERAL_SERVICE_INTENT,
  INTENT_COMPATIBILITY,
};
