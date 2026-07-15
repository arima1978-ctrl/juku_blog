'use strict';

// Sprint 3.6: scripts/seo_page_draft_generate.js(dry-run既定・--save明示時のみDB保存)のテスト。
// 保存テストは必ず一時SQLite(JUKU_BLOG_DB_PATH)で行い、実データ(data/posts.sqlite)は使わない。
// このCLI自体はClaude Code subagentを起動しない(prompt-file/result-fileを読むだけ)。

const os = require('node:os');
const path = require('node:path');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_page_draft_generate_cli_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { ROOT } = require('../scripts/lib/config');
const { closeDb, getDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');
const { resolveDraftGenerate } = require('../scripts/seo_page_draft_generate');

const TMP_DIR = os.tmpdir();
const PROMPT_FILE = path.join(TMP_DIR, `juku_blog_page_draft_generate_prompt_${process.pid}.json`);
const RESULT_FILE = path.join(TMP_DIR, `juku_blog_page_draft_generate_result_${process.pid}.json`);

after(() => {
  closeDb();
  [process.env.JUKU_BLOG_DB_PATH, PROMPT_FILE, RESULT_FILE].forEach((f) => {
    try {
      fs.unlinkSync(f);
    } catch {
      // 既に無ければ無視
    }
  });
});

const nowIso = '2026-07-16T00:00:00.000Z';

function seedPlan(pageId, { status = 'approved', sourceContentHash = 'a'.repeat(64) } = {}) {
  const candidate = seoDb.upsertKeywordCandidate(
    { normalized_keyword: `GenerateCLIテスト ${pageId}`, target_area: 'x', gap_type: 'weak', priority_score: 70, data_confidence: 75 },
    nowIso
  );
  const task = seoDb.upsertTask(
    {
      task_type: 'improve_school_page', target_keyword: `GenerateCLIテスト ${pageId}`, source_candidate_id: candidate.id,
      opportunity_score: 74, recommended_action: 'improve_school_page',
      target_url: `https://an-english.com/school/${pageId}/`, target_page_type: 'school_page',
      target_page_id: pageId, target_page_name: 'GenerateCLIテスト教室', reason: ['school_page_template'],
    },
    nowIso
  );
  const plan = seoDb.upsertSeoPagePlan(
    {
      groupKey: `school_page:${pageId}`, targetPageType: 'school_page', targetPageId: pageId,
      targetPageName: 'GenerateCLIテスト教室', targetUrl: `https://an-english.com/school/${pageId}/`,
      primaryTaskId: task.id, primaryKeyword: `GenerateCLIテスト ${pageId}`,
      supportingTaskIds: [], supportingKeywords: [], excludedTasks: [], combinedSearchIntents: ['general_service'],
      selectionBreakdown: {}, factCheckSummary: { verified: [], unverified: [], conflicting: [] }, warnings: [],
      sourceContentHash, promptVersion: null, status: 'proposed',
    },
    nowIso
  );
  if (status !== 'proposed') {
    seoDb.transitionSeoPagePlanStatus({ pagePlanId: plan.id, expectedCurrentStatus: 'proposed', nextStatus: 'reviewing', actor: 'setup', source: 'cli' }, nowIso);
    if (status !== 'reviewing') {
      seoDb.transitionSeoPagePlanStatus({ pagePlanId: plan.id, expectedCurrentStatus: 'reviewing', nextStatus: status, actor: 'setup', reason: status === 'rejected' ? '準備' : undefined, source: 'cli' }, nowIso);
    }
  }
  return { planId: plan.id, taskId: task.id };
}

function writePromptFile(plan, contentHash = 'a'.repeat(64)) {
  fs.writeFileSync(
    PROMPT_FILE,
    JSON.stringify({
      ok: true,
      planId: plan.id,
      promptVersion: 'page-draft-v1',
      prompt: 'テストPrompt全文',
      inputSummary: { pagePlanId: plan.id, pagePlanUpdatedAt: plan.updated_at, sourceContentHash: contentHash },
    }),
    'utf8'
  );
}

function writeResultFile(primaryTaskId, overrides = {}) {
  fs.writeFileSync(
    RESULT_FILE,
    JSON.stringify({
      can_generate: true,
      summary: '導入文追加',
      suggested_location: '見出し直後',
      generated_text: 'テスト教室は地域密着で指導を行っています。',
      change_reason: 'テスト理由',
      search_intent_alignment: 'テスト整合性',
      covered_task_ids: [primaryTaskId],
      covered_keywords: [],
      excluded_task_ids: [],
      excluded_intents: [],
      warnings: [],
      ...overrides,
    }),
    'utf8'
  );
}

test('CLI: growth_director.enabled=false(既定)なら無処理で終了する', () => {
  const output = execFileSync('node', [path.join(ROOT, 'scripts', 'seo_page_draft_generate.js'), '--plan-id=1', '--prompt-file=x', '--result-file=x', '--dry-run'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(output, /無処理で終了/);
});

test('resolveDraftGenerate: dry-run(save=false)ではDBへ保存しない', () => {
  const { planId, taskId } = seedPlan('generate-dry-run', { status: 'approved' });
  const plan = seoDb.getSeoPagePlanById(planId);
  writePromptFile(plan);
  writeResultFile(taskId);
  const result = resolveDraftGenerate({ planId, promptFilePath: PROMPT_FILE, resultFilePath: RESULT_FILE, save: false });
  assert.equal(result.ok, true);
  assert.equal(result.saved, false);
  assert.equal(result.draftVersion, 1);
  assert.equal(seoDb.listSeoPageDrafts({ pagePlanId: planId }).length, 0);
});

test('resolveDraftGenerate: --save相当(save=true)で一時SQLiteへ保存できる', () => {
  const { planId, taskId } = seedPlan('generate-save', { status: 'approved' });
  const plan = seoDb.getSeoPagePlanById(planId);
  writePromptFile(plan);
  writeResultFile(taskId);
  const result = resolveDraftGenerate({ planId, promptFilePath: PROMPT_FILE, resultFilePath: RESULT_FILE, save: true });
  assert.equal(result.ok, true);
  assert.equal(result.saved, true);
  assert.ok(result.saveResult.id > 0);
  assert.equal(seoDb.listSeoPageDrafts({ pagePlanId: planId }).length, 1);
});

test('resolveDraftGenerate: 不正なDraft(covered_task_idsにPrimaryが無い)はinvalid_draftで保存されない', () => {
  const { planId, taskId } = seedPlan('generate-invalid', { status: 'approved' });
  const plan = seoDb.getSeoPagePlanById(planId);
  writePromptFile(plan);
  writeResultFile(taskId, { covered_task_ids: [] }); // Primaryが含まれない
  const result = resolveDraftGenerate({ planId, promptFilePath: PROMPT_FILE, resultFilePath: RESULT_FILE, save: true });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'invalid_draft');
  assert.equal(seoDb.listSeoPageDrafts({ pagePlanId: planId }).length, 0);
});

test('resolveDraftGenerate: reviewing Planはpage_plan_not_approvedで保存拒否される(dry-runでも検出)', () => {
  const { planId, taskId } = seedPlan('generate-reviewing', { status: 'reviewing' });
  const plan = seoDb.getSeoPagePlanById(planId);
  writePromptFile(plan);
  writeResultFile(taskId);
  const result = resolveDraftGenerate({ planId, promptFilePath: PROMPT_FILE, resultFilePath: RESULT_FILE, save: false });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'page_plan_not_approved');
});

test('resolveDraftGenerate: Page Planのupdated_atが変化していればpage_plan_changed_during_generation', () => {
  const { planId, taskId } = seedPlan('generate-changed', { status: 'approved' });
  const plan = seoDb.getSeoPagePlanById(planId);
  writePromptFile(plan); // このスナップショットのupdated_atを使う
  writeResultFile(taskId);
  // Prompt生成後にPage Planのupdated_atだけ変化させる(承認済みのため直接DBを操作してシミュレート)
  const conn = getDb();
  conn.prepare('UPDATE seo_page_plans SET updated_at = :updated_at WHERE id = :id').run({ updated_at: '2099-01-01T00:00:00.000Z', id: planId });

  const result = resolveDraftGenerate({ planId, promptFilePath: PROMPT_FILE, resultFilePath: RESULT_FILE, save: true });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'page_plan_changed_during_generation');
  assert.equal(seoDb.listSeoPageDrafts({ pagePlanId: planId }).length, 0);
});

test('resolveDraftGenerate: content hashが変化していればpage_plan_content_stale', () => {
  const { planId, taskId } = seedPlan('generate-stale', { status: 'approved', sourceContentHash: 'a'.repeat(64) });
  const plan = seoDb.getSeoPagePlanById(planId);
  writePromptFile(plan, 'b'.repeat(64)); // Promptファイル時点で既にhashが食い違う想定
  writeResultFile(taskId);
  const result = resolveDraftGenerate({ planId, promptFilePath: PROMPT_FILE, resultFilePath: RESULT_FILE, save: true });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'page_plan_content_stale');
});

test('resolveDraftGenerate: 2回目の生成はdraft_version=2になる', () => {
  const { planId, taskId } = seedPlan('generate-version2', { status: 'approved' });
  const plan = seoDb.getSeoPagePlanById(planId);
  writePromptFile(plan);
  writeResultFile(taskId);
  const first = resolveDraftGenerate({ planId, promptFilePath: PROMPT_FILE, resultFilePath: RESULT_FILE, save: true });
  assert.equal(first.draftVersion, 1);
  const second = resolveDraftGenerate({ planId, promptFilePath: PROMPT_FILE, resultFilePath: RESULT_FILE, save: true });
  assert.equal(second.draftVersion, 2);
  assert.equal(seoDb.listSeoPageDrafts({ pagePlanId: planId }).length, 2);
});

test('Task/Page Plan statusを変更しない: resolveDraftGenerate(save=true)実行前後で不変', () => {
  const { planId, taskId } = seedPlan('generate-status-unaffected', { status: 'approved' });
  const plan = seoDb.getSeoPagePlanById(planId);
  writePromptFile(plan);
  writeResultFile(taskId);
  resolveDraftGenerate({ planId, promptFilePath: PROMPT_FILE, resultFilePath: RESULT_FILE, save: true });
  assert.equal(seoDb.getTaskById(taskId).status, 'proposed');
  assert.equal(seoDb.getSeoPagePlanById(planId).status, 'approved');
});

test('外部通信・LLM・WordPress呼び出しが無いこと(Claude subagent自動実行なし)', () => {
  const files = [path.join(ROOT, 'scripts', 'seo_page_draft_generate.js')];
  files.forEach((f) => {
    const content = fs.readFileSync(f, 'utf8');
    assert.ok(!/require\(['"]https?['"]\)/.test(content));
    assert.ok(!/require\(['"](openai|@anthropic-ai|@google\/generative-ai)['"]\)/i.test(content));
    assert.ok(!/wp-json/.test(content));
    assert.ok(!/fetch\(/.test(content));
    assert.ok(!/claude\s+-p/.test(content));
    assert.ok(!/require\(['"]node:child_process['"]\)/.test(content), 'child_processでsubagentを自動起動していないこと');
  });
});
