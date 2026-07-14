'use strict';

// Sprint 3.4: page_task_grouper.js(Primary/Supporting/Excluded分類)+
// supporting_task_fact_checker.js(ページ本文による事実確認)の結果を、
// seo_page_plansへ保存可能な1つのプレーンオブジェクトへまとめる決定的処理。
// DB書き込み・LLM呼び出しは一切行わない(このモジュールはオブジェクトを組み立てるだけ)。

const { GENERAL_SERVICE_INTENT, gapTypeRank } = require('./page_task_grouper');

// Primary選定の確定順序(page_task_grouper.jsのcomparePrimaryCandidatesと対応):
//   1. search_intent優先(general_serviceなら0、それ以外は1)
//   2. data_confidence降順
//   3. GSC impressions降順
//   4. gap_type優先順位(weak > shared > missing > untapped > content_gap > strong)
//   5. opportunity_score降順
//   6. task_id昇順
// average_positionはPrimary選定に使用しない(需要・露出の代理指標としてもここでは不要)。
function buildSelectionBreakdown(primaryTask) {
  return {
    searchIntentPriority: primaryTask.searchIntent === GENERAL_SERVICE_INTENT ? 0 : 1,
    dataConfidence: primaryTask.dataConfidence ?? null,
    gscImpressions: primaryTask.gscImpressions ?? null,
    gapTypePriority: gapTypeRank(primaryTask.gapType),
    opportunityScore: primaryTask.opportunityScore,
    taskId: primaryTask.taskId,
  };
}

// Supporting Fact Checkの結果を監査可能な形へ整理する。
// GSC実績は「提供事実の根拠」としては一切含めない(需要指標であり事実確認には使わない方針)。
function buildFactCheckSummary(group) {
  const summary = { verified: [], unverified: [], conflicting: [] };

  group.supportingTasks.forEach((task) => {
    if (task.factStatus !== 'verified') return;
    summary.verified.push({
      taskId: task.taskId,
      serviceTerm: task.factEvidence ? task.factEvidence.serviceTerm : null,
      matchedTerms: task.factEvidence ? task.factEvidence.matchedTerms : [],
      evidenceSources: task.factEvidence ? task.factEvidence.evidenceSources : [],
    });
  });

  group.excludedTasks.forEach((excluded) => {
    if (excluded.factStatus === 'unverified') {
      summary.unverified.push({
        taskId: excluded.taskId,
        serviceTerm: excluded.factEvidence ? excluded.factEvidence.serviceTerm : null,
        reason: excluded.factReason || null,
      });
    } else if (excluded.factStatus === 'conflicting') {
      summary.conflicting.push({
        taskId: excluded.taskId,
        serviceTerm: excluded.factEvidence ? excluded.factEvidence.serviceTerm : null,
        matchedTerms: excluded.factEvidence ? excluded.factEvidence.matchedTerms : [],
        evidenceSources: excluded.factEvidence ? excluded.factEvidence.evidenceSources : [],
        reason: excluded.factReason || null,
      });
    }
  });

  return summary;
}

// group: page_task_grouper.groupTasksByPage()が返した1グループ分のオブジェクトに、
//   supporting_task_fact_checker.applySupportingFactChecks()を適用済みのもの。
// pageContext: そのグループのtarget_urlに対応するpageContext
//   (contentHashの取得のみに使う。本文全文はここでは一切保持しない)。
// 戻り値: DB保存可能なプレーンオブジェクト(Primary候補が無い場合はnull)。
function buildPagePlan(group, pageContext) {
  if (!group.primaryTask) return null;

  const primary = group.primaryTask;
  const combinedSearchIntents = [
    ...new Set([primary.searchIntent, ...group.supportingTasks.map((t) => t.searchIntent)].filter(Boolean)),
  ];

  return {
    groupKey: group.groupKey,
    targetPageType: group.targetPageType,
    targetPageId: group.targetPageId,
    targetPageName: group.targetPageName,
    targetUrl: group.targetUrl,

    primaryTaskId: primary.taskId,
    primaryKeyword: primary.targetKeyword,

    supportingTaskIds: group.supportingTasks.map((t) => t.taskId),
    supportingKeywords: group.supportingTasks.map((t) => t.targetKeyword),

    excludedTasks: group.excludedTasks.map((e) => ({
      taskId: e.taskId,
      targetKeyword: e.targetKeyword,
      reason: e.reason,
      ...(e.duplicateOf ? { duplicateOf: e.duplicateOf } : {}),
      ...(e.intentFamily ? { intentFamily: e.intentFamily } : {}),
      ...(e.factStatus ? { factStatus: e.factStatus, factEvidence: e.factEvidence, factReason: e.factReason } : {}),
    })),

    combinedSearchIntents,

    selectionBreakdown: buildSelectionBreakdown(primary),
    factCheckSummary: buildFactCheckSummary(group),
    warnings: group.warnings,

    sourceContentHash: pageContext && pageContext.status === 'fetched' ? pageContext.contentHash || null : null,
    promptVersion: null, // 将来Draft生成時に使うPromptVersionの記録用(今回は未使用)

    status: 'proposed',
  };
}

const ALLOWED_PAGE_PLAN_STATUSES = new Set(['proposed', 'reviewing', 'approved', 'rejected']);
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;

// 保存時バリデーション(DB非依存の構造チェックのみ)。
// primary_task_idが実際にseo_tasksへ存在するかはDB参照が要るため、呼び出し側
// (scripts/lib/seo_db.jsのupsertSeoPagePlan)がこの関数の結果と合わせて確認すること。
function validatePagePlanShape(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object') {
    return { valid: false, errors: ['planはオブジェクトである必要があります'] };
  }

  if (!plan.groupKey) errors.push('groupKeyは必須です');
  if (!plan.targetPageType) errors.push('targetPageTypeは必須です');
  if (!plan.targetPageId) errors.push('targetPageIdは必須です');
  if (plan.primaryTaskId == null) errors.push('primaryTaskIdは必須です');
  if (!plan.primaryKeyword) errors.push('primaryKeywordは必須です');
  if (!Array.isArray(plan.supportingTaskIds)) errors.push('supportingTaskIdsは配列である必要があります');
  if (!Array.isArray(plan.excludedTasks)) errors.push('excludedTasksは配列である必要があります');
  if (!Array.isArray(plan.warnings)) errors.push('warningsは配列である必要があります');
  if (plan.status && !ALLOWED_PAGE_PLAN_STATUSES.has(plan.status)) errors.push(`statusが不正です: ${plan.status}`);

  if (Array.isArray(plan.supportingTaskIds) && plan.primaryTaskId != null && plan.supportingTaskIds.includes(plan.primaryTaskId)) {
    errors.push('primaryTaskIdがsupportingTaskIdsに重複しています');
  }

  if (Array.isArray(plan.supportingTaskIds) && Array.isArray(plan.excludedTasks)) {
    const excludedIds = new Set(plan.excludedTasks.map((e) => e.taskId));
    const dupWithSupporting = plan.supportingTaskIds.filter((id) => excludedIds.has(id));
    if (dupWithSupporting.length > 0) {
      errors.push(`supportingTaskIdsとexcludedTasksが重複しています: ${dupWithSupporting.join(',')}`);
    }
  }

  if (Array.isArray(plan.excludedTasks)) {
    const knownIds = new Set([plan.primaryTaskId, ...(Array.isArray(plan.supportingTaskIds) ? plan.supportingTaskIds : [])]);
    plan.excludedTasks.forEach((e) => {
      if (e && e.duplicateOf != null && !knownIds.has(e.duplicateOf)) {
        errors.push(`excludedTasks(taskId=${e.taskId}).duplicateOf(${e.duplicateOf})がPrimary/Supportingのいずれにも存在しません`);
      }
    });
  }

  if (plan.sourceContentHash != null && !SHA256_HEX_PATTERN.test(plan.sourceContentHash)) {
    errors.push('sourceContentHashはnullまたはSHA-256形式(64桁16進数)である必要があります');
  }

  try {
    JSON.stringify(plan);
  } catch {
    errors.push('planをJSON.stringifyできません');
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  buildPagePlan,
  buildSelectionBreakdown,
  buildFactCheckSummary,
  validatePagePlanShape,
  ALLOWED_PAGE_PLAN_STATUSES,
};
