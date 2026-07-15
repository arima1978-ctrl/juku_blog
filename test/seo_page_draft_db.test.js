'use strict';

// Sprint 3.6: seo_db.jsのPage Draft CRUD(insertSeoPageDraft等)のテスト。
// 必ず一時SQLite(JUKU_BLOG_DB_PATH)を使い、実データ(data/posts.sqlite)は一切変更しない。

const os = require('node:os');
const path = require('node:path');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_page_draft_db_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { closeDb, getDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');
const { buildPageDraft } = require('../scripts/lib/seo/page_draft_builder');

after(() => {
  closeDb();
  try {
    fs.unlinkSync(process.env.JUKU_BLOG_DB_PATH);
  } catch {
    // 既に無ければ無視
  }
});

const nowIso = '2026-07-16T00:00:00.000Z';
const laterIso = '2026-07-16T01:00:00.000Z';

function seedPlan(pageId, status = 'approved') {
  const candidate = seoDb.upsertKeywordCandidate(
    { normalized_keyword: `Draftテスト ${pageId}`, target_area: 'x', gap_type: 'weak', priority_score: 70, data_confidence: 70 },
    nowIso
  );
  const task = seoDb.upsertTask(
    {
      task_type: 'improve_school_page', target_keyword: `Draftテスト ${pageId}`, source_candidate_id: candidate.id,
      opportunity_score: 70, recommended_action: 'improve_school_page',
      target_url: `https://an-english.com/school/${pageId}/`, target_page_type: 'school_page',
      target_page_id: pageId, target_page_name: 'Draftテスト教室', reason: ['school_page_template'],
    },
    nowIso
  );
  const plan = seoDb.upsertSeoPagePlan(
    {
      groupKey: `school_page:${pageId}`, targetPageType: 'school_page', targetPageId: pageId,
      targetPageName: 'Draftテスト教室', targetUrl: `https://an-english.com/school/${pageId}/`,
      primaryTaskId: task.id, primaryKeyword: `Draftテスト ${pageId}`,
      supportingTaskIds: [], supportingKeywords: [], excludedTasks: [], combinedSearchIntents: [],
      selectionBreakdown: {}, factCheckSummary: {}, warnings: [],
      sourceContentHash: 'a'.repeat(64), promptVersion: null, status: 'proposed',
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

function fakeResponse(overrides = {}) {
  return {
    can_generate: true,
    summary: '導入文追加',
    suggested_location: '見出し直後',
    generated_text: 'テスト教室は地域に根ざした指導を行っています。',
    change_reason: 'テスト理由',
    search_intent_alignment: 'テスト整合性',
    covered_task_ids: [],
    covered_keywords: [],
    excluded_task_ids: [],
    excluded_intents: [],
    warnings: [],
    ...overrides,
  };
}

function buildDraftFor(planId, { draftVersion, contentHash = 'a'.repeat(64), pagePlanUpdatedAt } = {}) {
  const plan = seoDb.getSeoPagePlanById(planId);
  return buildPageDraft({
    pagePlan: { id: planId, updated_at: pagePlanUpdatedAt || plan.updated_at },
    prompt: 'テストPrompt全文',
    promptVersion: 'page-draft-v1',
    response: fakeResponse({ covered_task_ids: [plan.primary_task_id] }),
    validationResult: { valid: true, errors: [], warnings: [] },
    generator: 'test',
    model: null,
    pageContext: { status: 'fetched', contentHash },
    draftVersion: draftVersion || seoDb.getNextSeoPageDraftVersion(planId),
  });
}

test('insertSeoPageDraft: approved Planへ新規INSERTできる(draft_version=1)', () => {
  const { planId } = seedPlan('draft-insert', 'approved');
  const draft = buildDraftFor(planId);
  const result = seoDb.insertSeoPageDraft(draft, nowIso);
  assert.equal(result.draftVersion, 1);
  const fetched = seoDb.getSeoPageDraftById(result.id);
  assert.equal(fetched.page_plan_id, planId);
  assert.equal(fetched.status, 'generated');
  assert.equal(fetched.edited_text, null);
});

test('insertSeoPageDraft: 2件目はdraft_version=2で、過去Draftを上書きしない', () => {
  const { planId } = seedPlan('draft-version-2', 'approved');
  const draft1 = buildDraftFor(planId);
  const first = seoDb.insertSeoPageDraft(draft1, nowIso);
  const draft2 = buildDraftFor(planId, { summary: '2回目' });
  const second = seoDb.insertSeoPageDraft(draft2, laterIso);
  assert.equal(first.draftVersion, 1);
  assert.equal(second.draftVersion, 2);
  const all = seoDb.listSeoPageDrafts({ pagePlanId: planId });
  assert.equal(all.length, 2);
  assert.equal(seoDb.getSeoPageDraftById(first.id).id, first.id); // 1件目は残っている(上書きされていない)
});

test('getLatestSeoPageDraftByPlan: 最新版(最大draft_version)を返す', () => {
  const { planId } = seedPlan('draft-latest', 'approved');
  seoDb.insertSeoPageDraft(buildDraftFor(planId), nowIso);
  seoDb.insertSeoPageDraft(buildDraftFor(planId), laterIso);
  const latest = seoDb.getLatestSeoPageDraftByPlan(planId);
  assert.equal(latest.draft_version, 2);
});

test('listSeoPageDrafts: pagePlanId/statusでフィルタできる', () => {
  const { planId } = seedPlan('draft-list', 'approved');
  seoDb.insertSeoPageDraft(buildDraftFor(planId), nowIso);
  const byPlan = seoDb.listSeoPageDrafts({ pagePlanId: planId });
  assert.equal(byPlan.length, 1);
  const byStatus = seoDb.listSeoPageDrafts({ pagePlanId: planId, status: 'generated' });
  assert.equal(byStatus.length, 1);
  const byWrongStatus = seoDb.listSeoPageDrafts({ pagePlanId: planId, status: 'approved' });
  assert.equal(byWrongStatus.length, 0);
});

test('getNextSeoPageDraftVersion: Draftが無ければ1、あれば+1', () => {
  const { planId } = seedPlan('draft-next-version', 'approved');
  assert.equal(seoDb.getNextSeoPageDraftVersion(planId), 1);
  seoDb.insertSeoPageDraft(buildDraftFor(planId, { draftVersion: 1 }), nowIso);
  assert.equal(seoDb.getNextSeoPageDraftVersion(planId), 2);
});

test('insertSeoPageDraft: reviewing Planは拒否される(page_plan_not_approved)', () => {
  const { planId } = seedPlan('draft-reviewing-reject', 'reviewing');
  const draft = buildDraftFor(planId);
  try {
    seoDb.insertSeoPageDraft(draft, nowIso);
    assert.fail('reviewing Planは拒否されるべき');
  } catch (err) {
    assert.equal(err.code, 'page_plan_not_approved');
    assert.equal(err.actualStatus, 'reviewing');
  }
  assert.equal(seoDb.listSeoPageDrafts({ pagePlanId: planId }).length, 0);
});

test('insertSeoPageDraft: proposed Planは拒否される(page_plan_not_approved)', () => {
  const { planId } = seedPlan('draft-proposed-reject', 'proposed');
  const draft = buildDraftFor(planId);
  assert.throws(() => seoDb.insertSeoPageDraft(draft, nowIso), (err) => err.code === 'page_plan_not_approved');
});

test('insertSeoPageDraft: rejected Planは拒否される(page_plan_not_approved)', () => {
  const { planId } = seedPlan('draft-rejected-reject', 'rejected');
  const draft = buildDraftFor(planId);
  assert.throws(() => seoDb.insertSeoPageDraft(draft, nowIso), (err) => err.code === 'page_plan_not_approved');
});

test('insertSeoPageDraft: Page Planのupdated_atが変化していた場合は拒否される(page_plan_changed_during_generation)', () => {
  const { planId } = seedPlan('draft-stale-updated-at', 'approved');
  const staleUpdatedAt = seoDb.getSeoPagePlanById(planId).updated_at;
  // Page Planを更新(supporting_task_idsは変えず、statusをapprovedのまま維持したPlan再生成相当)
  const plan = seoDb.getSeoPagePlanById(planId);
  // approvedはロックされ更新できないため、代わりに直接DBのupdated_atだけを変更してシミュレートする
  const conn = getDb();
  conn.prepare("UPDATE seo_page_plans SET updated_at = :updated_at WHERE id = :id").run({ updated_at: '2099-01-01T00:00:00.000Z', id: planId });

  const draft = buildDraftFor(planId, { pagePlanUpdatedAt: staleUpdatedAt });
  try {
    seoDb.insertSeoPageDraft(draft, nowIso);
    assert.fail('updated_at不一致は拒否されるべき');
  } catch (err) {
    assert.equal(err.code, 'page_plan_changed_during_generation');
  }
  assert.equal(seoDb.listSeoPageDrafts({ pagePlanId: planId }).length, 0);
});

test('insertSeoPageDraft: source_content_hashが変化していた場合は拒否される(page_plan_content_stale)', () => {
  const { planId } = seedPlan('draft-stale-hash', 'approved');
  const plan = seoDb.getSeoPagePlanById(planId);
  const draft = buildDraftFor(planId, { contentHash: 'b'.repeat(64), pagePlanUpdatedAt: plan.updated_at }); // Plan保存時は'a'.repeat(64)
  try {
    seoDb.insertSeoPageDraft(draft, nowIso);
    assert.fail('hash不一致は拒否されるべき');
  } catch (err) {
    assert.equal(err.code, 'page_plan_content_stale');
  }
  assert.equal(seoDb.listSeoPageDrafts({ pagePlanId: planId }).length, 0);
});

test('concurrent version競合防止: 同一draft_versionの2件目挿入はUNIQUE制約でエラーになる', () => {
  const { planId } = seedPlan('draft-concurrent-version', 'approved');
  const draft1 = buildDraftFor(planId, { draftVersion: 1 });
  seoDb.insertSeoPageDraft(draft1, nowIso);
  const draft2 = buildDraftFor(planId, { draftVersion: 1, summary: '競合テスト' }); // 意図的に同じversion
  assert.throws(() => seoDb.insertSeoPageDraft(draft2, laterIso));
  assert.equal(seoDb.listSeoPageDrafts({ pagePlanId: planId }).length, 1);
});

test('Task statusを変更しない: insertSeoPageDraft実行前後でTaskのstatusが変わらない', () => {
  const { planId, taskId } = seedPlan('draft-task-unaffected', 'approved');
  seoDb.insertSeoPageDraft(buildDraftFor(planId), nowIso);
  const task = seoDb.getTaskById(taskId);
  assert.equal(task.status, 'proposed');
});

test('Page Plan statusを変更しない: insertSeoPageDraft実行前後でPage Planのstatusが変わらない', () => {
  const { planId } = seedPlan('draft-plan-unaffected', 'approved');
  seoDb.insertSeoPageDraft(buildDraftFor(planId), nowIso);
  const plan = seoDb.getSeoPagePlanById(planId);
  assert.equal(plan.status, 'approved');
});

test('他テーブル不変: insertSeoPageDraft実行前後でseo_tasks/seo_keyword_candidates/seo_page_plansの件数が変化しない', () => {
  const conn = getDb();
  const { planId } = seedPlan('draft-other-tables-unaffected', 'approved');
  const before = {
    tasks: conn.prepare('SELECT COUNT(*) c FROM seo_tasks').get().c,
    candidates: conn.prepare('SELECT COUNT(*) c FROM seo_keyword_candidates').get().c,
    plans: conn.prepare('SELECT COUNT(*) c FROM seo_page_plans').get().c,
  };
  seoDb.insertSeoPageDraft(buildDraftFor(planId), nowIso);
  const after1 = {
    tasks: conn.prepare('SELECT COUNT(*) c FROM seo_tasks').get().c,
    candidates: conn.prepare('SELECT COUNT(*) c FROM seo_keyword_candidates').get().c,
    plans: conn.prepare('SELECT COUNT(*) c FROM seo_page_plans').get().c,
  };
  assert.deepEqual(after1, before);
});

test('insertSeoPageDraft: 不正なdraft shapeは保存前にエラーになる', () => {
  assert.throws(() => seoDb.insertSeoPageDraft({ pagePlanId: 1 }, nowIso), /不正なPage Draft/);
});
