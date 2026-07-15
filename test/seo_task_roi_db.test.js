'use strict';

// Sprint 3.8: seo_db.jsのupsertTask()がROI関連6カラム(difficulty_score/
// difficulty_breakdown/expected_impact_clicks/expected_impact_cv/roi_priority_score/
// roi_score_computed_at)を正しく保存・読み取りできることを検証する。
// 必ず一時SQLite(JUKU_BLOG_DB_PATH)を使い、実データ(data/posts.sqlite)は一切変更しない。

const os = require('node:os');
const path = require('node:path');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_task_roi_db_test_${process.pid}.sqlite`);

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

const nowIso = '2026-07-19T00:00:00.000Z';

test('upsertTask(INSERT): ROI関連フィールドを指定すると保存・読み取りできる', () => {
  const created = seoDb.upsertTask(
    {
      task_type: 'improve_school_page',
      target_keyword: 'ROI DBテスト 塾',
      opportunity_score: 60,
      recommended_action: 'improve_school_page',
      difficulty_score: 42,
      difficulty_breakdown: { base: 10, competitorCount: 3, countPoints: 18 },
      expected_impact_clicks: 90,
      expected_impact_cv: 1.35,
      roi_priority_score: 78,
      roi_score_computed_at: nowIso,
    },
    nowIso
  );

  const task = seoDb.getTaskById(created.id);
  assert.equal(task.difficulty_score, 42);
  assert.deepEqual(task.difficulty_breakdown, { base: 10, competitorCount: 3, countPoints: 18 });
  assert.equal(task.expected_impact_clicks, 90);
  assert.equal(task.expected_impact_cv, 1.35);
  assert.equal(task.roi_priority_score, 78);
  assert.equal(task.roi_score_computed_at, nowIso);
});

test('upsertTask(INSERT): ROI関連フィールドを省略した場合はすべてNULL(既存呼び出し元との後方互換)', () => {
  const created = seoDb.upsertTask(
    {
      task_type: 'add_faq',
      target_keyword: 'ROI DB省略テスト',
      opportunity_score: 30,
      recommended_action: 'add_faq',
    },
    nowIso
  );

  const task = seoDb.getTaskById(created.id);
  assert.equal(task.difficulty_score, null);
  assert.equal(task.difficulty_breakdown, null);
  assert.equal(task.expected_impact_clicks, null);
  assert.equal(task.expected_impact_cv, null);
  assert.equal(task.roi_priority_score, null);
  assert.equal(task.roi_score_computed_at, null);
});

test('upsertTask(UPDATE): 既存Taskを再度upsertするとROI関連フィールドも更新される', () => {
  const created = seoDb.upsertTask(
    {
      task_type: 'create_article',
      target_keyword: 'ROI DB更新テスト',
      opportunity_score: 50,
      recommended_action: 'create_article',
      difficulty_score: 20,
      expected_impact_cv: 0.5,
      roi_priority_score: 40,
    },
    nowIso
  );

  const laterIso = '2026-07-19T01:00:00.000Z';
  const updated = seoDb.upsertTask(
    {
      task_type: 'create_article',
      target_keyword: 'ROI DB更新テスト',
      opportunity_score: 55,
      recommended_action: 'create_article',
      difficulty_score: 25,
      difficulty_breakdown: { base: 10 },
      expected_impact_clicks: 40,
      expected_impact_cv: 0.6,
      roi_priority_score: 60,
      roi_score_computed_at: laterIso,
    },
    laterIso
  );

  assert.equal(updated.id, created.id);
  assert.equal(updated.isNew, false);

  const task = seoDb.getTaskById(created.id);
  assert.equal(task.difficulty_score, 25);
  assert.deepEqual(task.difficulty_breakdown, { base: 10 });
  assert.equal(task.expected_impact_clicks, 40);
  assert.equal(task.expected_impact_cv, 0.6);
  assert.equal(task.roi_priority_score, 60);
  assert.equal(task.roi_score_computed_at, laterIso);
});

test('既存opportunity_score/opportunity_breakdownは無変更のまま(回帰確認)', () => {
  const created = seoDb.upsertTask(
    {
      task_type: 'improve_existing_article',
      target_keyword: 'ROI DB回帰テスト',
      opportunity_score: 65,
      opportunity_breakdown: { competitor_adoption: { ratio: 0.5, points: 10 } },
      recommended_action: 'improve_existing_article',
      difficulty_score: 30,
    },
    nowIso
  );

  const task = seoDb.getTaskById(created.id);
  assert.equal(task.opportunity_score, 65);
  assert.deepEqual(task.opportunity_breakdown, { competitor_adoption: { ratio: 0.5, points: 10 } });
});
