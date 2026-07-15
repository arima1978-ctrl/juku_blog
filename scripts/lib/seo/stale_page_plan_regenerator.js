'use strict';

// Sprint 3.7: stale化したPage Planを、最新のSEO Tasks・pageContextから再計算する。
// 新しい分類ロジックは作らず、既存資産(page_task_grouper.js/page_plan_builder.js、
// および呼び出し側が適用済みのSupporting Fact Check)をそのまま再利用する。
// DB書き込み・LLM呼び出し・外部通信は一切行わない(pageContextは呼び出し側が
// 既存のbuildPageContext()で取得済みのものを渡す)。

const { groupTasksByPage, applySupportingFactChecks } = require('./page_task_grouper');
const { buildPagePlan } = require('./page_plan_builder');

// enrichedTasks: scripts/seo_page_task_group_preview.jsのbuildEnrichedTasks()相当
//   (呼び出し側がDBから解決済みの拡張Task配列。この関数自体はDBへ一切アクセスしない)。
// targetPageType/targetPageId: 再計算対象の1ページに絞り込むためのフィルタ
//   (Page Task Grouperは複数ページを一度に扱えるが、stale再生成は対象ページのみに限定する)。
// pageContext: 最新のpageContext(呼び出し側が既存buildPageContext()で取得済みのもの)。
// 戻り値: scripts/lib/seo/page_plan_builder.jsのbuildPagePlan()と同じ形の
//   プレーンオブジェクト(Primary候補が対象ページに無い場合はnull)。
function regeneratePagePlanContent({ enrichedTasks, targetPageType, targetPageId, pageContext }) {
  const filtered = (enrichedTasks || []).filter(
    (t) => t.targetPageType === targetPageType && t.targetPageId === targetPageId
  );
  const grouped = groupTasksByPage(filtered);
  const group = grouped.groups.find((g) => g.targetPageType === targetPageType && g.targetPageId === targetPageId);
  if (!group) return null;

  const factChecked = applySupportingFactChecks(group, pageContext);
  return buildPagePlan(factChecked, pageContext);
}

function sortedIds(ids) {
  return [...(ids || [])].sort((a, b) => a - b);
}

function sortedExcludedTaskIds(excludedTasks) {
  return sortedIds((excludedTasks || []).map((e) => e.taskId));
}

// currentPlan: scripts/lib/seo_db.jsのgetSeoPagePlanById()相当(snake_case、DB由来)。
// regeneratedPlan: この関数群のregeneratePagePlanContent()が返す形(camelCase)。
// 表示・監査用の比較であり、DB書き込みは行わない。
function comparePagePlanChanges(currentPlan, regeneratedPlan) {
  if (!currentPlan || !regeneratedPlan) {
    return { primaryChanged: null, supportingChanged: null, excludedChanged: null };
  }

  return {
    primaryChanged: currentPlan.primary_task_id !== regeneratedPlan.primaryTaskId,
    supportingChanged:
      JSON.stringify(sortedIds(currentPlan.supporting_task_ids)) !== JSON.stringify(sortedIds(regeneratedPlan.supportingTaskIds)),
    excludedChanged:
      JSON.stringify(sortedExcludedTaskIds(currentPlan.excluded_tasks)) !==
      JSON.stringify(sortedExcludedTaskIds(regeneratedPlan.excludedTasks)),
  };
}

module.exports = { regeneratePagePlanContent, comparePagePlanChanges };
