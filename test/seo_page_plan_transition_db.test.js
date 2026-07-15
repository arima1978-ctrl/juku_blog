'use strict';

// Sprint 3.5: seo_db.js transitionSeoPagePlanStatus/listSeoPagePlanReviews/
// getLatestSeoPagePlanReviewのテスト。必ず一時SQLite(JUKU_BLOG_DB_PATH)を使い、
// 実データ(data/posts.sqlite)は一切変更しない。

const os = require('node:os');
const path = require('node:path');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_page_plan_transition_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { closeDb, getDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');

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
const evenLaterIso = '2026-07-16T02:00:00.000Z';

function seedTaskAndPlan(pageId) {
  const candidate = seoDb.upsertKeywordCandidate(
    { normalized_keyword: `遷移テスト ${pageId}`, target_area: 'x', gap_type: 'weak', priority_score: 70, data_confidence: 70 },
    nowIso
  );
  const task = seoDb.upsertTask(
    {
      task_type: 'improve_school_page',
      target_keyword: `遷移テスト ${pageId}`,
      source_candidate_id: candidate.id,
      opportunity_score: 70,
      recommended_action: 'improve_school_page',
      target_url: `https://an-english.com/school/${pageId}/`,
      target_page_type: 'school_page',
      target_page_id: pageId,
      target_page_name: '遷移テスト教室',
      reason: ['school_page_template'],
    },
    nowIso
  );
  const plan = seoDb.upsertSeoPagePlan(
    {
      groupKey: `school_page:${pageId}`,
      targetPageType: 'school_page',
      targetPageId: pageId,
      targetPageName: '遷移テスト教室',
      targetUrl: `https://an-english.com/school/${pageId}/`,
      primaryTaskId: task.id,
      primaryKeyword: `遷移テスト ${pageId}`,
      supportingTaskIds: [],
      supportingKeywords: [],
      excludedTasks: [],
      combinedSearchIntents: [],
      selectionBreakdown: {},
      factCheckSummary: {},
      warnings: [],
      sourceContentHash: null,
      promptVersion: null,
      status: 'proposed',
    },
    nowIso
  );
  return { taskId: task.id, planId: plan.id };
}

test('transitionSeoPagePlanStatus: status更新とreview履歴INSERTが成功する', () => {
  const { planId } = seedTaskAndPlan('trans-basic');
  const result = seoDb.transitionSeoPagePlanStatus(
    { pagePlanId: planId, expectedCurrentStatus: 'proposed', nextStatus: 'reviewing', actor: 'admin', reason: '確認開始', source: 'cli' },
    nowIso
  );
  assert.equal(result.from, 'proposed');
  assert.equal(result.to, 'reviewing');
  const plan = seoDb.getSeoPagePlanById(planId);
  assert.equal(plan.status, 'reviewing');
  const reviews = seoDb.listSeoPagePlanReviews(planId);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].from_status, 'proposed');
  assert.equal(reviews[0].to_status, 'reviewing');
  assert.equal(reviews[0].actor, 'admin');
  assert.equal(reviews[0].reason, '確認開始');
  assert.equal(reviews[0].source, 'cli');
});

test('transitionSeoPagePlanStatus: 一連の遷移(proposed→reviewing→approved)を確認する', () => {
  const { planId } = seedTaskAndPlan('trans-approve-flow');
  seoDb.transitionSeoPagePlanStatus({ pagePlanId: planId, expectedCurrentStatus: 'proposed', nextStatus: 'reviewing', actor: 'admin', source: 'cli' }, nowIso);
  seoDb.transitionSeoPagePlanStatus({ pagePlanId: planId, expectedCurrentStatus: 'reviewing', nextStatus: 'approved', actor: 'admin', source: 'cli' }, laterIso);
  const plan = seoDb.getSeoPagePlanById(planId);
  assert.equal(plan.status, 'approved');
  const reviews = seoDb.listSeoPagePlanReviews(planId);
  assert.equal(reviews.length, 2);
  assert.equal(reviews[0].to_status, 'reviewing');
  assert.equal(reviews[1].to_status, 'approved');
});

test('transitionSeoPagePlanStatus: 一連の遷移(proposed→reviewing→rejected)を確認する', () => {
  const { planId } = seedTaskAndPlan('trans-reject-flow');
  seoDb.transitionSeoPagePlanStatus({ pagePlanId: planId, expectedCurrentStatus: 'proposed', nextStatus: 'reviewing', actor: 'admin', source: 'cli' }, nowIso);
  seoDb.transitionSeoPagePlanStatus({ pagePlanId: planId, expectedCurrentStatus: 'reviewing', nextStatus: 'rejected', actor: 'admin', reason: '不採用', source: 'cli' }, laterIso);
  const plan = seoDb.getSeoPagePlanById(planId);
  assert.equal(plan.status, 'rejected');
});

test('transitionSeoPagePlanStatus: review履歴の順序はid昇順(古い順)', () => {
  const { planId } = seedTaskAndPlan('trans-order');
  seoDb.transitionSeoPagePlanStatus({ pagePlanId: planId, expectedCurrentStatus: 'proposed', nextStatus: 'reviewing', actor: 'admin', source: 'cli' }, nowIso);
  seoDb.transitionSeoPagePlanStatus({ pagePlanId: planId, expectedCurrentStatus: 'reviewing', nextStatus: 'proposed', actor: 'admin', reason: '差し戻し', source: 'cli' }, laterIso);
  seoDb.transitionSeoPagePlanStatus({ pagePlanId: planId, expectedCurrentStatus: 'proposed', nextStatus: 'reviewing', actor: 'admin', source: 'cli' }, evenLaterIso);
  const reviews = seoDb.listSeoPagePlanReviews(planId);
  assert.equal(reviews.length, 3);
  assert.deepEqual(reviews.map((r) => r.to_status), ['reviewing', 'proposed', 'reviewing']);
});

test('getLatestSeoPagePlanReview: 最新のレビュー履歴を取得できる', () => {
  const { planId } = seedTaskAndPlan('trans-latest');
  seoDb.transitionSeoPagePlanStatus({ pagePlanId: planId, expectedCurrentStatus: 'proposed', nextStatus: 'reviewing', actor: 'admin', source: 'cli' }, nowIso);
  seoDb.transitionSeoPagePlanStatus({ pagePlanId: planId, expectedCurrentStatus: 'reviewing', nextStatus: 'approved', actor: 'admin', source: 'cli' }, laterIso);
  const latest = seoDb.getLatestSeoPagePlanReview(planId);
  assert.equal(latest.to_status, 'approved');
});

test('getLatestSeoPagePlanReview: レビュー履歴が無ければnull', () => {
  const { planId } = seedTaskAndPlan('trans-no-history');
  assert.equal(seoDb.getLatestSeoPagePlanReview(planId), null);
});

test('transitionSeoPagePlanStatus: expected statusと実際のstatusが異なる場合はpage_plan_status_conflict', () => {
  const { planId } = seedTaskAndPlan('trans-conflict');
  try {
    seoDb.transitionSeoPagePlanStatus(
      { pagePlanId: planId, expectedCurrentStatus: 'reviewing', nextStatus: 'approved', actor: 'admin', source: 'cli' },
      nowIso
    );
    assert.fail('conflictでエラーが投げられるべき');
  } catch (err) {
    assert.equal(err.code, 'page_plan_status_conflict');
    assert.equal(err.actualStatus, 'proposed');
  }
  const plan = seoDb.getSeoPagePlanById(planId);
  assert.equal(plan.status, 'proposed'); // 変更されていない
  assert.equal(seoDb.listSeoPagePlanReviews(planId).length, 0); // 履歴も追加されない
});

test('transitionSeoPagePlanStatus: 存在しないPage Plan IDはnot_found', () => {
  try {
    seoDb.transitionSeoPagePlanStatus(
      { pagePlanId: 999999, expectedCurrentStatus: 'proposed', nextStatus: 'reviewing', actor: 'admin', source: 'cli' },
      nowIso
    );
    assert.fail('not_foundでエラーが投げられるべき');
  } catch (err) {
    assert.equal(err.code, 'not_found');
  }
});

test('transitionSeoPagePlanStatus: approvedからの遷移は拒否されDB変更なし', () => {
  const { planId } = seedTaskAndPlan('trans-approved-reject');
  seoDb.transitionSeoPagePlanStatus({ pagePlanId: planId, expectedCurrentStatus: 'proposed', nextStatus: 'reviewing', actor: 'admin', source: 'cli' }, nowIso);
  seoDb.transitionSeoPagePlanStatus({ pagePlanId: planId, expectedCurrentStatus: 'reviewing', nextStatus: 'approved', actor: 'admin', source: 'cli' }, laterIso);

  try {
    seoDb.transitionSeoPagePlanStatus(
      { pagePlanId: planId, expectedCurrentStatus: 'approved', nextStatus: 'reviewing', actor: 'admin', reason: '再検討したい', source: 'cli' },
      evenLaterIso
    );
    assert.fail('approvedからの遷移はエラーになるべき');
  } catch (err) {
    assert.equal(err.code, 'invalid_transition');
  }
  const plan = seoDb.getSeoPagePlanById(planId);
  assert.equal(plan.status, 'approved'); // 変更されていない
  assert.equal(seoDb.listSeoPagePlanReviews(planId).length, 2); // 3件目は追加されない
});

test('transitionSeoPagePlanStatus: 不正なsourceは保存前にエラーになる', () => {
  const { planId } = seedTaskAndPlan('trans-bad-source');
  assert.throws(() => {
    seoDb.transitionSeoPagePlanStatus(
      { pagePlanId: planId, expectedCurrentStatus: 'proposed', nextStatus: 'reviewing', actor: 'admin', source: 'dashboard-hack' },
      nowIso
    );
  }, /不正なsource/);
  const plan = seoDb.getSeoPagePlanById(planId);
  assert.equal(plan.status, 'proposed');
});

test('review INSERT失敗時はUPDATEもrollbackされる(atomic transaction)', () => {
  const { planId } = seedTaskAndPlan('trans-rollback');
  const conn = getDb();
  conn.exec('DROP TABLE seo_page_plan_reviews'); // INSERT段階で必ず失敗させる

  assert.throws(() => {
    seoDb.transitionSeoPagePlanStatus(
      { pagePlanId: planId, expectedCurrentStatus: 'proposed', nextStatus: 'reviewing', actor: 'admin', source: 'cli' },
      nowIso
    );
  });

  const plan = seoDb.getSeoPagePlanById(planId);
  assert.equal(plan.status, 'proposed'); // UPDATEもrollbackされ、statusは変わっていない

  // 後続テストに影響しないようテーブルを復元する
  conn.exec(`
    CREATE TABLE IF NOT EXISTS seo_page_plan_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_plan_id INTEGER NOT NULL,
      from_status TEXT NOT NULL,
      to_status TEXT NOT NULL,
      actor TEXT NOT NULL,
      reason TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (page_plan_id) REFERENCES seo_page_plans(id)
    );
  `);
});

test('Task statusを変更しない: transitionSeoPagePlanStatus実行前後でTaskのstatusが変わらない', () => {
  const { planId, taskId } = seedTaskAndPlan('trans-task-unaffected');
  seoDb.transitionSeoPagePlanStatus({ pagePlanId: planId, expectedCurrentStatus: 'proposed', nextStatus: 'reviewing', actor: 'admin', source: 'cli' }, nowIso);
  const task = seoDb.getTaskById(taskId);
  assert.equal(task.status, 'proposed');
});

test('Page Plan内容(Primary/Supporting/Excluded)は変更されない: status以外のフィールドは不変', () => {
  const { planId } = seedTaskAndPlan('trans-content-unaffected');
  const before = seoDb.getSeoPagePlanById(planId);
  seoDb.transitionSeoPagePlanStatus({ pagePlanId: planId, expectedCurrentStatus: 'proposed', nextStatus: 'reviewing', actor: 'admin', source: 'cli' }, laterIso);
  const after1 = seoDb.getSeoPagePlanById(planId);
  assert.equal(after1.primary_task_id, before.primary_task_id);
  assert.equal(after1.primary_keyword, before.primary_keyword);
  assert.deepEqual(after1.supporting_task_ids, before.supporting_task_ids);
  assert.deepEqual(after1.excluded_tasks, before.excluded_tasks);
  assert.equal(after1.created_at, before.created_at);
  assert.notEqual(after1.updated_at, before.updated_at); // updated_atは変わる
});

test('他テーブル不変: transitionSeoPagePlanStatus実行前後でseo_tasks/seo_keyword_candidatesの件数が変化しない', () => {
  const conn = getDb();
  const before = {
    tasks: conn.prepare('SELECT COUNT(*) c FROM seo_tasks').get().c,
    candidates: conn.prepare('SELECT COUNT(*) c FROM seo_keyword_candidates').get().c,
  };
  const { planId } = seedTaskAndPlan('trans-other-tables');
  const afterSeed = {
    tasks: conn.prepare('SELECT COUNT(*) c FROM seo_tasks').get().c,
    candidates: conn.prepare('SELECT COUNT(*) c FROM seo_keyword_candidates').get().c,
  };
  seoDb.transitionSeoPagePlanStatus({ pagePlanId: planId, expectedCurrentStatus: 'proposed', nextStatus: 'reviewing', actor: 'admin', source: 'cli' }, nowIso);
  const afterTransition = {
    tasks: conn.prepare('SELECT COUNT(*) c FROM seo_tasks').get().c,
    candidates: conn.prepare('SELECT COUNT(*) c FROM seo_keyword_candidates').get().c,
  };
  assert.deepEqual(afterTransition, afterSeed);
  assert.equal(afterSeed.tasks, before.tasks + 1);
  assert.equal(afterSeed.candidates, before.candidates + 1);
});
