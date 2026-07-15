'use strict';

// Sprint 3.7: scripts/lib/seo_db.js regenerateStaleSeoPagePlan()のテスト。
// 必ず一時SQLite(JUKU_BLOG_DB_PATH)を使い、実データ(data/posts.sqlite)は一切変更しない。

const os = require('node:os');
const path = require('node:path');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_page_plan_regenerate_db_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { closeDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');

after(() => {
  closeDb();
  try {
    fs.unlinkSync(process.env.JUKU_BLOG_DB_PATH);
  } catch {
    // 既に無ければ無視
  }
});

const nowIso = '2026-07-17T00:00:00.000Z';
const laterIso = '2026-07-17T01:00:00.000Z';

const OLD_HASH = 'a'.repeat(64);
const NEW_HASH = 'b'.repeat(64);

function seedTaskAndPlan(pageId, { status = 'approved', sourceContentHash = OLD_HASH } = {}) {
  const candidate = seoDb.upsertKeywordCandidate(
    { normalized_keyword: `再生成DBテスト ${pageId}`, target_area: 'x', gap_type: 'weak', priority_score: 70, data_confidence: 70 },
    nowIso
  );
  const task = seoDb.upsertTask(
    {
      task_type: 'improve_school_page',
      target_keyword: `再生成DBテスト ${pageId}`,
      source_candidate_id: candidate.id,
      opportunity_score: 70,
      recommended_action: 'improve_school_page',
      target_url: `https://an-english.com/school/${pageId}/`,
      target_page_type: 'school_page',
      target_page_id: pageId,
      target_page_name: '再生成DBテスト教室',
      reason: ['school_page_template'],
    },
    nowIso
  );
  const plan = seoDb.upsertSeoPagePlan(
    {
      groupKey: `school_page:${pageId}`,
      targetPageType: 'school_page',
      targetPageId: pageId,
      targetPageName: '再生成DBテスト教室',
      targetUrl: `https://an-english.com/school/${pageId}/`,
      primaryTaskId: task.id,
      primaryKeyword: `再生成DBテスト ${pageId}`,
      supportingTaskIds: [],
      supportingKeywords: [],
      excludedTasks: [],
      combinedSearchIntents: ['general_service'],
      selectionBreakdown: {},
      factCheckSummary: { verified: [], unverified: [], conflicting: [] },
      warnings: [],
      sourceContentHash,
      promptVersion: null,
      status: 'proposed',
    },
    nowIso
  );
  if (status !== 'proposed') {
    seoDb.transitionSeoPagePlanStatus({ pagePlanId: plan.id, expectedCurrentStatus: 'proposed', nextStatus: 'reviewing', actor: 'setup', source: 'cli' }, nowIso);
    if (status !== 'reviewing') {
      seoDb.transitionSeoPagePlanStatus(
        { pagePlanId: plan.id, expectedCurrentStatus: 'reviewing', nextStatus: status, actor: 'setup', reason: status === 'rejected' ? '準備' : undefined, source: 'cli' },
        nowIso
      );
    }
  }
  return { planId: plan.id, taskId: task.id, candidateId: candidate.id };
}

function fakeRegeneratedPlan(pageId, { taskId, primaryKeyword = `再生成DBテスト ${pageId}` } = {}) {
  return {
    groupKey: `school_page:${pageId}`,
    targetPageType: 'school_page',
    targetPageId: pageId,
    targetPageName: '再生成DBテスト教室(更新後)',
    targetUrl: `https://an-english.com/school/${pageId}/`,
    primaryTaskId: taskId,
    primaryKeyword,
    supportingTaskIds: [],
    supportingKeywords: [],
    excludedTasks: [],
    combinedSearchIntents: ['general_service'],
    selectionBreakdown: { taskId },
    factCheckSummary: { verified: [], unverified: [], conflicting: [] },
    warnings: [],
    sourceContentHash: NEW_HASH,
    promptVersion: null,
    status: 'proposed',
  };
}

test('regenerateStaleSeoPagePlan: approved → stale → 内容更新 → proposedへ復帰(正常系)', () => {
  const { planId, taskId } = seedTaskAndPlan('regen-happy', { status: 'approved' });
  const before = seoDb.getSeoPagePlanById(planId);

  const result = seoDb.regenerateStaleSeoPagePlan(
    {
      pagePlanId: planId,
      expectedCurrentStatus: 'approved',
      expectedUpdatedAt: before.updated_at,
      actor: 'admin',
      reason: '本文変更のため再分析',
      staleMetadata: { previousContentHash: OLD_HASH, currentContentHash: NEW_HASH, staleReason: 'content_hash_mismatch' },
      regeneratedPlan: fakeRegeneratedPlan('regen-happy', { taskId, primaryKeyword: '更新後キーワード' }),
    },
    laterIso
  );

  assert.equal(result.finalStatus, 'proposed');
  assert.equal(result.plan.status, 'proposed');
  assert.equal(result.plan.primary_keyword, '更新後キーワード');
  assert.equal(result.plan.source_content_hash, NEW_HASH);
  assert.equal(result.plan.created_at, before.created_at); // created_atは維持
  assert.equal(result.plan.updated_at, laterIso); // updated_atは変更

  const reviews = seoDb.listSeoPagePlanReviews(planId);
  assert.equal(reviews.length, 2 + 2); // seedで2件(proposed→reviewing→approved) + 今回2件
  const [staleReview, proposedReview] = reviews.slice(-2);
  assert.equal(staleReview.from_status, 'approved');
  assert.equal(staleReview.to_status, 'stale');
  assert.equal(staleReview.actor, 'admin');
  assert.equal(staleReview.reason, '本文変更のため再分析');
  assert.deepEqual(staleReview.metadata, { previousContentHash: OLD_HASH, currentContentHash: NEW_HASH, staleReason: 'content_hash_mismatch' });

  assert.equal(proposedReview.from_status, 'stale');
  assert.equal(proposedReview.to_status, 'proposed');
  assert.equal(proposedReview.actor, 'admin');
  assert.ok(proposedReview.reason && proposedReview.reason.length > 0);
});

test('regenerateStaleSeoPagePlan: reviewing Planも再生成できる', () => {
  const { planId, taskId } = seedTaskAndPlan('regen-reviewing', { status: 'reviewing' });
  const before = seoDb.getSeoPagePlanById(planId);

  const result = seoDb.regenerateStaleSeoPagePlan(
    {
      pagePlanId: planId,
      expectedCurrentStatus: 'reviewing',
      expectedUpdatedAt: before.updated_at,
      actor: 'admin',
      reason: '本文変更のため',
      staleMetadata: {},
      regeneratedPlan: fakeRegeneratedPlan('regen-reviewing', { taskId }),
    },
    laterIso
  );
  assert.equal(result.finalStatus, 'proposed');
});

test('regenerateStaleSeoPagePlan: proposed Planも再生成できる', () => {
  const { planId, taskId } = seedTaskAndPlan('regen-proposed', { status: 'proposed' });
  const before = seoDb.getSeoPagePlanById(planId);

  const result = seoDb.regenerateStaleSeoPagePlan(
    {
      pagePlanId: planId,
      expectedCurrentStatus: 'proposed',
      expectedUpdatedAt: before.updated_at,
      actor: 'admin',
      reason: '本文変更のため',
      staleMetadata: {},
      regeneratedPlan: fakeRegeneratedPlan('regen-proposed', { taskId }),
    },
    laterIso
  );
  assert.equal(result.finalStatus, 'proposed');
});

test('regenerateStaleSeoPagePlan: 存在しないPage Plan IDはnot_found', () => {
  try {
    seoDb.regenerateStaleSeoPagePlan(
      {
        pagePlanId: 999999,
        expectedCurrentStatus: 'approved',
        expectedUpdatedAt: nowIso,
        actor: 'admin',
        reason: '理由',
        staleMetadata: {},
        regeneratedPlan: fakeRegeneratedPlan('nonexistent', { taskId: 1 }),
      },
      laterIso
    );
    assert.fail('not_foundでエラーが投げられるべき');
  } catch (err) {
    assert.equal(err.code, 'not_found');
  }
});

test('regenerateStaleSeoPagePlan: expectedCurrentStatus不一致はpage_plan_status_conflictでロールバックされる', () => {
  const { planId, taskId } = seedTaskAndPlan('regen-status-conflict', { status: 'approved' });
  const before = seoDb.getSeoPagePlanById(planId);
  const beforeReviewCount = seoDb.listSeoPagePlanReviews(planId).length;

  try {
    seoDb.regenerateStaleSeoPagePlan(
      {
        pagePlanId: planId,
        expectedCurrentStatus: 'reviewing', // 実際はapproved
        expectedUpdatedAt: before.updated_at,
        actor: 'admin',
        reason: '理由',
        staleMetadata: {},
        regeneratedPlan: fakeRegeneratedPlan('regen-status-conflict', { taskId }),
      },
      laterIso
    );
    assert.fail('page_plan_status_conflictでエラーが投げられるべき');
  } catch (err) {
    assert.equal(err.code, 'page_plan_status_conflict');
    assert.equal(err.actualStatus, 'approved');
  }

  const after = seoDb.getSeoPagePlanById(planId);
  assert.equal(after.status, 'approved'); // 変更されていない
  assert.equal(after.source_content_hash, OLD_HASH); // 内容も変更されていない
  assert.equal(seoDb.listSeoPagePlanReviews(planId).length, beforeReviewCount); // 履歴も追加されない
});

test('regenerateStaleSeoPagePlan: expectedUpdatedAt不一致はpage_plan_changed_during_regenerationでロールバックされる', () => {
  const { planId, taskId } = seedTaskAndPlan('regen-updatedat-conflict', { status: 'approved' });
  const beforeReviewCount = seoDb.listSeoPagePlanReviews(planId).length;

  try {
    seoDb.regenerateStaleSeoPagePlan(
      {
        pagePlanId: planId,
        expectedCurrentStatus: 'approved',
        expectedUpdatedAt: '2000-01-01T00:00:00.000Z', // 実際のupdated_atと異なる
        actor: 'admin',
        reason: '理由',
        staleMetadata: {},
        regeneratedPlan: fakeRegeneratedPlan('regen-updatedat-conflict', { taskId }),
      },
      laterIso
    );
    assert.fail('page_plan_changed_during_regenerationでエラーが投げられるべき');
  } catch (err) {
    assert.equal(err.code, 'page_plan_changed_during_regeneration');
  }

  const after = seoDb.getSeoPagePlanById(planId);
  assert.equal(after.status, 'approved'); // 変更されていない
  assert.equal(seoDb.listSeoPagePlanReviews(planId).length, beforeReviewCount);
});

test('regenerateStaleSeoPagePlan: rejected Planは再生成できず(invalid_transition)ロールバックされる', () => {
  const { planId, taskId } = seedTaskAndPlan('regen-rejected', { status: 'rejected' });
  const before = seoDb.getSeoPagePlanById(planId);
  const beforeReviewCount = seoDb.listSeoPagePlanReviews(planId).length;

  try {
    seoDb.regenerateStaleSeoPagePlan(
      {
        pagePlanId: planId,
        expectedCurrentStatus: 'rejected',
        expectedUpdatedAt: before.updated_at,
        actor: 'admin',
        reason: '理由',
        staleMetadata: {},
        regeneratedPlan: fakeRegeneratedPlan('regen-rejected', { taskId }),
      },
      laterIso
    );
    assert.fail('invalid_transitionでエラーが投げられるべき');
  } catch (err) {
    assert.equal(err.code, 'invalid_transition');
  }

  const after = seoDb.getSeoPagePlanById(planId);
  assert.equal(after.status, 'rejected'); // 変更されていない
  assert.equal(after.source_content_hash, OLD_HASH); // 内容も変更されていない(ROLLBACK済み)
  assert.equal(seoDb.listSeoPagePlanReviews(planId).length, beforeReviewCount); // 履歴も追加されない
});

test('regenerateStaleSeoPagePlan: 不正なregeneratedPlanは保存前にエラーになる(DB変更なし)', () => {
  const { planId } = seedTaskAndPlan('regen-bad-shape', { status: 'approved' });
  const before = seoDb.getSeoPagePlanById(planId);
  const beforeReviewCount = seoDb.listSeoPagePlanReviews(planId).length;

  assert.throws(() => {
    seoDb.regenerateStaleSeoPagePlan(
      {
        pagePlanId: planId,
        expectedCurrentStatus: 'approved',
        expectedUpdatedAt: before.updated_at,
        actor: 'admin',
        reason: '理由',
        staleMetadata: {},
        regeneratedPlan: { groupKey: null }, // primaryTaskId等が欠落した不正な形
      },
      laterIso
    );
  });

  const after = seoDb.getSeoPagePlanById(planId);
  assert.equal(after.status, 'approved');
  assert.equal(seoDb.listSeoPagePlanReviews(planId).length, beforeReviewCount);
});

test('regenerateStaleSeoPagePlan: seo_tasks/seo_keyword_candidatesは一切変更しない', () => {
  const { planId, taskId, candidateId } = seedTaskAndPlan('regen-task-unchanged', { status: 'approved' });
  const before = seoDb.getSeoPagePlanById(planId);
  const taskBefore = seoDb.getTaskById(taskId);
  const candidateBefore = seoDb.getKeywordCandidateById(candidateId);

  seoDb.regenerateStaleSeoPagePlan(
    {
      pagePlanId: planId,
      expectedCurrentStatus: 'approved',
      expectedUpdatedAt: before.updated_at,
      actor: 'admin',
      reason: '理由',
      staleMetadata: {},
      regeneratedPlan: fakeRegeneratedPlan('regen-task-unchanged', { taskId }),
    },
    laterIso
  );

  const taskAfter = seoDb.getTaskById(taskId);
  const candidateAfter = seoDb.getKeywordCandidateById(candidateId);
  assert.deepEqual(taskAfter, taskBefore);
  assert.deepEqual(candidateAfter, candidateBefore);
});
