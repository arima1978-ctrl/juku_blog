'use strict';

// Sprint 3.9: AI Weekly Director。roi_priority_score(Sprint 3.8)を主軸に、
// 工数予算(effortBudgetMinutes)とタスクタイプ多様性(maxPerTaskType)の制約下で
// 「今週着手すべき3〜5件」を決定的に選定する。AIには選ばせない(既存のOpportunity
// Score・ROI Priority Scoreと同じ哲学)。DB書き込み・LLM呼び出しは一切行わない。

const DEFAULT_TARGET_COUNT = { min: 3, max: 5 };
const DEFAULT_EFFORT_BUDGET_MINUTES = 60;
const DEFAULT_MAX_PER_TASK_TYPE = 2;

// 貪欲法: 予算・タイプ上限を超える候補はスキップし、次の(スコアが劣る)候補を試す。
// 先頭からの単純カットオフではなく、軽いタスクを後から拾えるようにするための設計。
function attemptSelection(pool, { max, budget, perTypeLimit }) {
  const selected = [];
  let usedMinutes = 0;
  const countByType = {};

  for (const task of pool) {
    if (selected.length >= max) break;
    const minutes = task.estimated_effort_minutes ?? 0;
    const typeCount = countByType[task.task_type] || 0;
    if (usedMinutes + minutes > budget) continue;
    if (typeCount >= perTypeLimit) continue;
    selected.push(task);
    usedMinutes += minutes;
    countByType[task.task_type] = typeCount + 1;
  }

  return { selected, usedMinutes, countByType };
}

function sumExpectedCv(tasks) {
  return tasks.reduce((sum, t) => sum + (t.expected_impact_cv || 0), 0);
}

// candidateTasks: seoDb.listTasks({status:'proposed'})相当(snake_case、
//   roi_priority_score/expected_impact_cv/estimated_effort_minutes/task_typeを持つ)。
// 戻り値: { selectedTasks, totalExpectedCv, totalEffortMinutes, taskTypeBreakdown, curationTier }
function curateWeeklyTasks(candidateTasks, options = {}) {
  const targetCount = { ...DEFAULT_TARGET_COUNT, ...(options.targetCount || {}) };
  const effortBudgetMinutes = options.effortBudgetMinutes ?? DEFAULT_EFFORT_BUDGET_MINUTES;
  const maxPerTaskType = options.maxPerTaskType ?? DEFAULT_MAX_PER_TASK_TYPE;

  const primaryPool = (candidateTasks || [])
    .filter((t) => t.roi_priority_score != null)
    .sort((a, b) => b.roi_priority_score - a.roi_priority_score);

  const fallbackPool = (candidateTasks || [])
    .filter((t) => t.roi_priority_score == null)
    .sort((a, b) => (b.opportunity_score || 0) - (a.opportunity_score || 0));

  // 第1段階(strict): roi_priority_score降順、工数予算・同タイプ最大maxPerTaskType件を厳守。
  let result = attemptSelection(primaryPool, { max: targetCount.max, budget: effortBudgetMinutes, perTypeLimit: maxPerTaskType });
  let curationTier = 'strict';

  // 第2段階(relaxed_diversity): min件未満なら、同タイプ上限を+1件緩和して再選定。
  if (result.selected.length < targetCount.min) {
    result = attemptSelection(primaryPool, { max: targetCount.max, budget: effortBudgetMinutes, perTypeLimit: maxPerTaskType + 1 });
    curationTier = 'relaxed_diversity';
  }

  // 第3段階(fallback_pool_used): それでもmin件未満なら、roi_priority_scoreが
  // 算出不能(null)な予備候補(opportunity_score降順)も動員して穴埋めする。
  if (result.selected.length < targetCount.min) {
    const combinedPool = [...primaryPool, ...fallbackPool];
    result = attemptSelection(combinedPool, { max: targetCount.max, budget: effortBudgetMinutes, perTypeLimit: maxPerTaskType + 1 });
    curationTier = 'fallback_pool_used';
  }

  return {
    selectedTasks: result.selected,
    totalExpectedCv: sumExpectedCv(result.selected),
    totalEffortMinutes: result.usedMinutes,
    taskTypeBreakdown: result.countByType,
    curationTier,
  };
}

module.exports = {
  curateWeeklyTasks,
  DEFAULT_TARGET_COUNT,
  DEFAULT_EFFORT_BUDGET_MINUTES,
  DEFAULT_MAX_PER_TASK_TYPE,
};
