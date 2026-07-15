'use strict';

// Sprint 3.9: AI Weekly Directorが選定したTaskごとに、Draft/Page Plan Prompt生成を
// 振り分ける。Claude Code subagentは一切起動しない(Promptファイルを生成・保存する
// ところまでがこのモジュールの責務)。DB書き込みは行わない(呼び出し元の
// seo_weekly_director.jsが、この結果をitems JSONとしてまとめて--save時に保存する)。
//
// 分岐:
//   校舎ページ更新系Task(target_page_type==='school_page'):
//     Page Planが無い          → blocked_no_page_plan
//     Page Planがapproved以外  → blocked_page_plan_not_approved
//     Page Planがstale         → blocked_page_plan_stale
//     Page Planがapproved・非stale → resolveDraftPreview()(scripts/seo_page_draft_preview.js、
//       既存のapproved/stale判定を含むheadless関数)でPrompt生成 → prompt_generated
//   その他のTask(校舎ページに紐づかない単発Task。ブログ新規・FAQ等):
//     buildDraftPreview()(scripts/lib/seo/draft_generator.js)でPrompt生成 → prompt_generated
//     (Sprint 3.9時点ではTask単位DraftのDB永続化テーブルは無いため、ファイル出力のみ)

const fs = require('node:fs');
const path = require('node:path');
const { buildDraftPreview } = require('./draft_generator');
const { resolveDraftPreview: resolvePageDraftPreview } = require('../../seo_page_draft_preview');

const SCHOOL_PAGE_TYPE = 'school_page';

function promptFilePath(outputDir, batchDate, taskId) {
  return path.join(outputDir, `weekly_${batchDate}_task_${taskId}.prompt.json`);
}

function writePromptFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf8');
}

function blockedItem(task, draftStatus, { pagePlanId = null, pagePlanStatus = null } = {}) {
  return {
    taskId: task.id,
    taskType: task.task_type,
    draftStatus,
    draftPromptPath: null,
    pagePlanId,
    pagePlanStatus,
  };
}

// task: seoDb.getTaskById()相当(snake_case)。
// seoDbImpl: seoDb実装(テストでは差し替え可能)。
// pageContextDeps: buildPageContext/fetchPageContextへの依存注入(テスト用、実通信回避)。
// outputDir: Promptファイルの出力先ディレクトリ(テストでは一時ディレクトリを指定する)。
async function dispatchOneTask(task, batchDate, { seoDbImpl, pageContextDeps, outputDir, resolvePageDraftPreviewImpl = resolvePageDraftPreview, buildDraftPreviewImpl = buildDraftPreview }) {
  if (task.target_page_type === SCHOOL_PAGE_TYPE) {
    const pagePlan = seoDbImpl.getSeoPagePlanByPage(task.target_page_type, task.target_page_id);

    if (!pagePlan) {
      return blockedItem(task, 'blocked_no_page_plan');
    }
    if (pagePlan.status !== 'approved') {
      return blockedItem(task, 'blocked_page_plan_not_approved', { pagePlanId: pagePlan.id, pagePlanStatus: pagePlan.status });
    }

    const previewResult = await resolvePageDraftPreviewImpl({ planId: pagePlan.id, pageContextDeps });
    if (!previewResult.ok) {
      const statusByErrorCode = {
        page_plan_content_stale: 'blocked_page_plan_stale',
        page_context_not_available: 'blocked_page_context_not_available',
        page_plan_not_approved: 'blocked_page_plan_not_approved',
        not_found: 'blocked_no_page_plan',
      };
      return blockedItem(task, statusByErrorCode[previewResult.errorCode] || 'blocked_unknown', {
        pagePlanId: pagePlan.id,
        pagePlanStatus: pagePlan.status,
      });
    }

    const filePath = promptFilePath(outputDir, batchDate, task.id);
    writePromptFile(filePath, previewResult);
    return {
      taskId: task.id,
      taskType: task.task_type,
      draftStatus: 'prompt_generated',
      draftPromptPath: filePath,
      pagePlanId: pagePlan.id,
      pagePlanStatus: pagePlan.status,
    };
  }

  // 校舎ページに紐づかない単発Task(create_article/add_faq/add_internal_links等)。
  const candidate = task.source_candidate_id ? seoDbImpl.getKeywordCandidateById(task.source_candidate_id) : null;
  const gscMetrics = seoDbImpl.getGscAggregateForKeyword(task.target_keyword);
  const preview = await buildDraftPreviewImpl({ task, candidate, gscMetrics }, { pageContextDeps });

  const filePath = promptFilePath(outputDir, batchDate, task.id);
  writePromptFile(filePath, preview);
  return {
    taskId: task.id,
    taskType: task.task_type,
    draftStatus: 'prompt_generated',
    draftPromptPath: filePath,
    pagePlanId: null,
    pagePlanStatus: null,
  };
}

// selectedTasks: weekly_task_curator.curateWeeklyTasks()が返すselectedTasks相当
//   (seoDb.getTaskById()と同じsnake_caseフィールドを持つTask配列)。
// batchDate: 'YYYY-MM-DD'(その週の月曜日)。
// 戻り値: items(JSON配列、seo_weekly_recommendations.itemsへ保存する形そのもの)。
async function dispatchWeeklyDrafts(selectedTasks, batchDate, options = {}) {
  const {
    seoDbImpl = require('../seo_db'),
    pageContextDeps,
    outputDir = path.join('data', 'seo_drafts'),
    resolvePageDraftPreviewImpl,
    buildDraftPreviewImpl,
  } = options;

  const items = [];
  for (const task of selectedTasks || []) {
    const item = await dispatchOneTask(task, batchDate, {
      seoDbImpl,
      pageContextDeps,
      outputDir,
      resolvePageDraftPreviewImpl,
      buildDraftPreviewImpl,
    });
    items.push(item);
  }
  return items;
}

module.exports = { dispatchWeeklyDrafts, promptFilePath };
