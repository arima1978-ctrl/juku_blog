'use strict';

// Sprint 3.9: weekly_draft_dispatcher.js(Task種別ごとのDraft/Page Plan Prompt振り分け)の
// 単体テスト。全分岐をスタブ(fake seoDb/resolvePageDraftPreview/buildDraftPreview)で検証する。
// 実DB・実ネットワーク接続・Claude subagent実行は一切発生しない。Promptファイルは
// 一時ディレクトリへのみ書き込む。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { dispatchWeeklyDrafts, promptFilePath } = require('../scripts/lib/seo/weekly_draft_dispatcher');

const TMP_DIR = path.join(os.tmpdir(), `juku_blog_weekly_dispatcher_test_${process.pid}`);

after(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

const BATCH_DATE = '2026-07-13';

function schoolPageTask(overrides = {}) {
  return {
    id: 1,
    task_type: 'improve_school_page',
    target_page_type: 'school_page',
    target_page_id: 'obata',
    target_url: 'https://an-english.com/school/obata/',
    target_keyword: '守山区 塾',
    source_candidate_id: null,
    opportunity_score: 70,
    reason: [],
    ...overrides,
  };
}

function standaloneTask(overrides = {}) {
  return {
    id: 2,
    task_type: 'create_article',
    target_page_type: null,
    target_page_id: null,
    target_url: null,
    target_keyword: '守山区 高校入試',
    source_candidate_id: null,
    opportunity_score: 60,
    reason: [],
    ...overrides,
  };
}

function fakeSeoDb(overrides = {}) {
  return {
    getSeoPagePlanByPage: () => null,
    getKeywordCandidateById: () => null,
    getGscAggregateForKeyword: () => null,
    ...overrides,
  };
}

test('school_pageタスク: Page Planが無ければblocked_no_page_planになる', async () => {
  const task = schoolPageTask();
  const items = await dispatchWeeklyDrafts([task], BATCH_DATE, {
    seoDbImpl: fakeSeoDb({ getSeoPagePlanByPage: () => null }),
    outputDir: TMP_DIR,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].draftStatus, 'blocked_no_page_plan');
  assert.equal(items[0].draftPromptPath, null);
  assert.equal(items[0].pagePlanId, null);
});

test('school_pageタスク: Page Planがproposedならblocked_page_plan_not_approvedになる', async () => {
  const task = schoolPageTask();
  const items = await dispatchWeeklyDrafts([task], BATCH_DATE, {
    seoDbImpl: fakeSeoDb({ getSeoPagePlanByPage: () => ({ id: 10, status: 'proposed' }) }),
    outputDir: TMP_DIR,
  });
  assert.equal(items[0].draftStatus, 'blocked_page_plan_not_approved');
  assert.equal(items[0].pagePlanId, 10);
  assert.equal(items[0].pagePlanStatus, 'proposed');
});

test('school_pageタスク: Page Planがreviewingならblocked_page_plan_not_approvedになる', async () => {
  const task = schoolPageTask();
  const items = await dispatchWeeklyDrafts([task], BATCH_DATE, {
    seoDbImpl: fakeSeoDb({ getSeoPagePlanByPage: () => ({ id: 11, status: 'reviewing' }) }),
    outputDir: TMP_DIR,
  });
  assert.equal(items[0].draftStatus, 'blocked_page_plan_not_approved');
});

test('school_pageタスク: approvedだがstale検知ならblocked_page_plan_staleになる', async () => {
  const task = schoolPageTask();
  const items = await dispatchWeeklyDrafts([task], BATCH_DATE, {
    seoDbImpl: fakeSeoDb({ getSeoPagePlanByPage: () => ({ id: 12, status: 'approved' }) }),
    resolvePageDraftPreviewImpl: async () => ({ ok: false, errorCode: 'page_plan_content_stale' }),
    outputDir: TMP_DIR,
  });
  assert.equal(items[0].draftStatus, 'blocked_page_plan_stale');
  assert.equal(items[0].pagePlanId, 12);
  assert.equal(items[0].pagePlanStatus, 'approved');
});

test('school_pageタスク: approvedだがpageContext取得失敗ならblocked_page_context_not_availableになる', async () => {
  const task = schoolPageTask();
  const items = await dispatchWeeklyDrafts([task], BATCH_DATE, {
    seoDbImpl: fakeSeoDb({ getSeoPagePlanByPage: () => ({ id: 13, status: 'approved' }) }),
    resolvePageDraftPreviewImpl: async () => ({ ok: false, errorCode: 'page_context_not_available' }),
    outputDir: TMP_DIR,
  });
  assert.equal(items[0].draftStatus, 'blocked_page_context_not_available');
});

test('school_pageタスク: approved・非staleならprompt_generatedとなりPromptファイルが書き込まれる', async () => {
  const task = schoolPageTask({ id: 99 });
  const fakePreview = { ok: true, prompt: 'テストPrompt本文', promptVersion: 'page-draft-v1' };
  const items = await dispatchWeeklyDrafts([task], BATCH_DATE, {
    seoDbImpl: fakeSeoDb({ getSeoPagePlanByPage: () => ({ id: 20, status: 'approved' }) }),
    resolvePageDraftPreviewImpl: async ({ planId }) => {
      assert.equal(planId, 20);
      return fakePreview;
    },
    outputDir: TMP_DIR,
  });
  assert.equal(items[0].draftStatus, 'prompt_generated');
  assert.equal(items[0].pagePlanId, 20);
  assert.equal(items[0].pagePlanStatus, 'approved');
  assert.equal(items[0].draftPromptPath, promptFilePath(TMP_DIR, BATCH_DATE, 99));

  const written = JSON.parse(fs.readFileSync(items[0].draftPromptPath, 'utf8'));
  assert.deepEqual(written, fakePreview);
});

test('単発タスク(校舎ページ非紐づき): buildDraftPreviewが呼ばれprompt_generatedとなる', async () => {
  const task = standaloneTask({ id: 55 });
  const fakePreview = { task_id: 55, prompt: 'Task単位テストPrompt' };
  const items = await dispatchWeeklyDrafts([task], BATCH_DATE, {
    seoDbImpl: fakeSeoDb(),
    buildDraftPreviewImpl: async ({ task: t, candidate, gscMetrics }) => {
      assert.equal(t.id, 55);
      assert.equal(candidate, null);
      assert.equal(gscMetrics, null);
      return fakePreview;
    },
    outputDir: TMP_DIR,
  });
  assert.equal(items[0].draftStatus, 'prompt_generated');
  assert.equal(items[0].pagePlanId, null);
  assert.equal(items[0].draftPromptPath, promptFilePath(TMP_DIR, BATCH_DATE, 55));

  const written = JSON.parse(fs.readFileSync(items[0].draftPromptPath, 'utf8'));
  assert.deepEqual(written, fakePreview);
});

test('単発タスク: source_candidate_idがあればgetKeywordCandidateByIdが呼ばれる', async () => {
  const task = standaloneTask({ id: 56, source_candidate_id: 7 });
  let calledWithId = null;
  await dispatchWeeklyDrafts([task], BATCH_DATE, {
    seoDbImpl: fakeSeoDb({
      getKeywordCandidateById: (id) => {
        calledWithId = id;
        return { id, normalized_keyword: 'x' };
      },
    }),
    buildDraftPreviewImpl: async () => ({ prompt: 'x' }),
    outputDir: TMP_DIR,
  });
  assert.equal(calledWithId, 7);
});

test('複数タスクを同時に処理し、それぞれの結果が独立して返る', async () => {
  const tasks = [
    schoolPageTask({ id: 1, target_page_id: 'obata' }),
    standaloneTask({ id: 2 }),
  ];
  const items = await dispatchWeeklyDrafts(tasks, BATCH_DATE, {
    seoDbImpl: fakeSeoDb({ getSeoPagePlanByPage: () => null }),
    buildDraftPreviewImpl: async () => ({ prompt: 'standalone' }),
    outputDir: TMP_DIR,
  });
  assert.equal(items.length, 2);
  assert.equal(items[0].taskId, 1);
  assert.equal(items[0].draftStatus, 'blocked_no_page_plan');
  assert.equal(items[1].taskId, 2);
  assert.equal(items[1].draftStatus, 'prompt_generated');
});

test('promptFilePath: weekly_<batchDate>_task_<id>.prompt.json形式になる', () => {
  const p = promptFilePath('data/seo_drafts', '2026-07-13', 61);
  assert.equal(p, path.join('data/seo_drafts', 'weekly_2026-07-13_task_61.prompt.json'));
});

test('空の選定リストなら空配列を返す', async () => {
  const items = await dispatchWeeklyDrafts([], BATCH_DATE, { seoDbImpl: fakeSeoDb(), outputDir: TMP_DIR });
  assert.deepEqual(items, []);
});
