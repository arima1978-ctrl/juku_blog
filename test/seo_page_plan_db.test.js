'use strict';

// Sprint 3.4: seo_db.jsのPage Plan CRUD(upsertSeoPagePlan等)のテスト。
// 必ず一時SQLite(JUKU_BLOG_DB_PATH)を使い、実データ(data/posts.sqlite)は一切変更しない。

const os = require('node:os');
const path = require('node:path');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_page_plan_db_test_${process.pid}.sqlite`);

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

const nowIso = '2026-07-15T00:00:00.000Z';
const laterIso = '2026-07-15T01:00:00.000Z';

function seedTask(keyword) {
  const candidate = seoDb.upsertKeywordCandidate(
    { normalized_keyword: keyword, target_area: 'x', gap_type: 'weak', priority_score: 70, data_confidence: 70 },
    nowIso
  );
  return seoDb.upsertTask(
    {
      task_type: 'improve_school_page',
      target_keyword: keyword,
      source_candidate_id: candidate.id,
      opportunity_score: 70,
      recommended_action: 'improve_school_page',
      target_url: 'https://an-english.com/school/db-test/',
      target_page_type: 'school_page',
      target_page_id: 'db-test',
      target_page_name: 'DBテスト教室',
      reason: ['school_page_template'],
    },
    nowIso
  );
}

function fakePlan(primaryTaskId, overrides = {}) {
  return {
    groupKey: 'school_page:db-test',
    targetPageType: 'school_page',
    targetPageId: 'db-test',
    targetPageName: 'DBテスト教室',
    targetUrl: 'https://an-english.com/school/db-test/',
    primaryTaskId,
    primaryKeyword: 'DBテスト 塾',
    supportingTaskIds: [],
    supportingKeywords: [],
    excludedTasks: [],
    combinedSearchIntents: ['general_service'],
    selectionBreakdown: { searchIntentPriority: 0, dataConfidence: 70, gscImpressions: null, gapTypePriority: 0, opportunityScore: 70, taskId: primaryTaskId },
    factCheckSummary: { verified: [], unverified: [], conflicting: [] },
    warnings: [],
    sourceContentHash: null,
    promptVersion: null,
    status: 'proposed',
    ...overrides,
  };
}

// --- INSERT / get ---

test('upsertSeoPagePlan: 新規INSERTできる', () => {
  const task = seedTask('DBテスト 塾 INSERT');
  const plan = fakePlan(task.id, { targetPageId: 'db-test-insert', groupKey: 'school_page:db-test-insert' });
  const result = seoDb.upsertSeoPagePlan(plan, nowIso);
  assert.equal(result.isNew, true);
  assert.equal(result.locked, false);
  assert.ok(result.id > 0);
});

test('getSeoPagePlanById: 保存したPlanを取得できる', () => {
  const task = seedTask('DBテスト 塾 getById');
  const plan = fakePlan(task.id, { targetPageId: 'db-test-getbyid', groupKey: 'school_page:db-test-getbyid', supportingTaskIds: [task.id] });
  // supportingにprimary自身を入れるのは本来不正だが、ここではDB層のJSON往復のみを確認する
  const validPlan = { ...plan, supportingTaskIds: [] };
  const result = seoDb.upsertSeoPagePlan(validPlan, nowIso);
  const fetched = seoDb.getSeoPagePlanById(result.id);
  assert.equal(fetched.primary_task_id, task.id);
  assert.equal(fetched.primary_keyword, 'DBテスト 塾');
  assert.deepEqual(fetched.supporting_task_ids, []);
  assert.deepEqual(fetched.combined_search_intents, ['general_service']);
});

test('getSeoPagePlanByPage: target_page_type/target_page_idで取得できる', () => {
  const task = seedTask('DBテスト 塾 getByPage');
  const plan = fakePlan(task.id, { targetPageId: 'db-test-getbypage', groupKey: 'school_page:db-test-getbypage' });
  seoDb.upsertSeoPagePlan(plan, nowIso);
  const fetched = seoDb.getSeoPagePlanByPage('school_page', 'db-test-getbypage');
  assert.ok(fetched);
  assert.equal(fetched.target_page_id, 'db-test-getbypage');
});

test('listSeoPagePlans: 一覧取得できる(statusフィルタ可)', () => {
  const task = seedTask('DBテスト 塾 list');
  const plan = fakePlan(task.id, { targetPageId: 'db-test-list', groupKey: 'school_page:db-test-list' });
  seoDb.upsertSeoPagePlan(plan, nowIso);
  const all = seoDb.listSeoPagePlans({});
  assert.ok(all.length >= 1);
  const proposedOnly = seoDb.listSeoPagePlans({ status: 'proposed' });
  assert.ok(proposedOnly.every((p) => p.status === 'proposed'));
});

// --- upsert(同ページ再実行) ---

test('upsertSeoPagePlan: 同ページ再実行はupsert(2件目にならない)', () => {
  const task = seedTask('DBテスト 塾 upsert');
  const plan = fakePlan(task.id, { targetPageId: 'db-test-upsert', groupKey: 'school_page:db-test-upsert' });
  const first = seoDb.upsertSeoPagePlan(plan, nowIso);
  const second = seoDb.upsertSeoPagePlan(plan, laterIso);
  assert.equal(first.id, second.id);
  assert.equal(second.isNew, false);
  const all = seoDb.listSeoPagePlans({}).filter((p) => p.target_page_id === 'db-test-upsert');
  assert.equal(all.length, 1);
});

test('upsertSeoPagePlan: proposed Planのupsertでcreated_atは維持されupdated_atは変わる', () => {
  const task = seedTask('DBテスト 塾 created_at');
  const plan = fakePlan(task.id, { targetPageId: 'db-test-createdat', groupKey: 'school_page:db-test-createdat' });
  const first = seoDb.upsertSeoPagePlan(plan, nowIso);
  const beforeUpdate = seoDb.getSeoPagePlanById(first.id);
  seoDb.upsertSeoPagePlan(plan, laterIso);
  const afterUpdate = seoDb.getSeoPagePlanById(first.id);
  assert.equal(afterUpdate.created_at, beforeUpdate.created_at);
  assert.equal(afterUpdate.created_at, nowIso);
  assert.equal(afterUpdate.updated_at, laterIso);
});

test('upsertSeoPagePlan: supporting/excludedの内容が更新される', () => {
  const task = seedTask('DBテスト 塾 supporting update');
  const supportingTask = seedTask('DBテスト 個別指導 supporting update');
  const plan1 = fakePlan(task.id, { targetPageId: 'db-test-supporting-update', groupKey: 'school_page:db-test-supporting-update' });
  const created = seoDb.upsertSeoPagePlan(plan1, nowIso);

  const plan2 = fakePlan(task.id, {
    targetPageId: 'db-test-supporting-update',
    groupKey: 'school_page:db-test-supporting-update',
    supportingTaskIds: [supportingTask.id],
    supportingKeywords: ['DBテスト 個別指導 supporting update'],
    excludedTasks: [{ taskId: 99999, targetKeyword: 'x', reason: 'duplicate_intent', duplicateOf: task.id }],
  });
  seoDb.upsertSeoPagePlan(plan2, laterIso);

  const fetched = seoDb.getSeoPagePlanById(created.id);
  assert.deepEqual(fetched.supporting_task_ids, [supportingTask.id]);
  assert.equal(fetched.excluded_tasks.length, 1);
});

// --- approved/reviewing/rejectedロック ---

test('upsertSeoPagePlan: proposed statusは上書き可', () => {
  const task = seedTask('DBテスト 塾 proposed lock check');
  const plan = fakePlan(task.id, { targetPageId: 'db-test-proposed-lock', groupKey: 'school_page:db-test-proposed-lock' });
  seoDb.upsertSeoPagePlan(plan, nowIso);
  const result = seoDb.upsertSeoPagePlan(plan, laterIso);
  assert.equal(result.locked, false);
});

test('upsertSeoPagePlan: rejected statusは内容更新可・statusはrejectedのまま維持', () => {
  const task = seedTask('DBテスト 塾 rejected');
  const plan = fakePlan(task.id, { targetPageId: 'db-test-rejected', groupKey: 'school_page:db-test-rejected' });
  const created = seoDb.upsertSeoPagePlan(plan, nowIso);
  seoDb.updateSeoPagePlanStatus(created.id, 'rejected', nowIso);

  const updatedPlan = fakePlan(task.id, {
    targetPageId: 'db-test-rejected',
    groupKey: 'school_page:db-test-rejected',
    primaryKeyword: 'DBテスト 塾 更新後',
  });
  const result = seoDb.upsertSeoPagePlan(updatedPlan, laterIso);
  assert.equal(result.locked, false);

  const fetched = seoDb.getSeoPagePlanById(created.id);
  assert.equal(fetched.status, 'rejected'); // statusは自動でproposedへ戻らない
  assert.equal(fetched.primary_keyword, 'DBテスト 塾 更新後'); // 内容は更新される
});

test('upsertSeoPagePlan: reviewing statusは上書き拒否(locked)', () => {
  const task = seedTask('DBテスト 塾 reviewing');
  const plan = fakePlan(task.id, { targetPageId: 'db-test-reviewing', groupKey: 'school_page:db-test-reviewing' });
  const created = seoDb.upsertSeoPagePlan(plan, nowIso);
  seoDb.updateSeoPagePlanStatus(created.id, 'reviewing', nowIso);

  const result = seoDb.upsertSeoPagePlan({ ...plan, primaryKeyword: '書き換え試行' }, laterIso);
  assert.equal(result.locked, true);
  assert.equal(result.lockedStatus, 'reviewing');

  const fetched = seoDb.getSeoPagePlanById(created.id);
  assert.equal(fetched.primary_keyword, 'DBテスト 塾'); // 内容が変わっていない
});

test('upsertSeoPagePlan: approved statusは上書き拒否(locked)', () => {
  const task = seedTask('DBテスト 塾 approved');
  const plan = fakePlan(task.id, { targetPageId: 'db-test-approved', groupKey: 'school_page:db-test-approved' });
  const created = seoDb.upsertSeoPagePlan(plan, nowIso);
  seoDb.updateSeoPagePlanStatus(created.id, 'approved', nowIso);

  const result = seoDb.upsertSeoPagePlan({ ...plan, primaryKeyword: '書き換え試行' }, laterIso);
  assert.equal(result.locked, true);
  assert.equal(result.lockedStatus, 'approved');

  const fetched = seoDb.getSeoPagePlanById(created.id);
  assert.equal(fetched.primary_keyword, 'DBテスト 塾');
});

// --- updateSeoPagePlanStatus / delete ---

test('updateSeoPagePlanStatus: statusを更新できる', () => {
  const task = seedTask('DBテスト 塾 status update');
  const plan = fakePlan(task.id, { targetPageId: 'db-test-status-update', groupKey: 'school_page:db-test-status-update' });
  const created = seoDb.upsertSeoPagePlan(plan, nowIso);
  const result = seoDb.updateSeoPagePlanStatus(created.id, 'approved', laterIso);
  assert.equal(result.from, 'proposed');
  assert.equal(result.to, 'approved');
});

test('updateSeoPagePlanStatus: 不正statusはエラー', () => {
  const task = seedTask('DBテスト 塾 invalid status');
  const plan = fakePlan(task.id, { targetPageId: 'db-test-invalid-status', groupKey: 'school_page:db-test-invalid-status' });
  const created = seoDb.upsertSeoPagePlan(plan, nowIso);
  assert.throws(() => seoDb.updateSeoPagePlanStatus(created.id, 'in_progress', laterIso));
});

test('deleteSeoPagePlan: 削除できる', () => {
  const task = seedTask('DBテスト 塾 delete');
  const plan = fakePlan(task.id, { targetPageId: 'db-test-delete', groupKey: 'school_page:db-test-delete' });
  const created = seoDb.upsertSeoPagePlan(plan, nowIso);
  const result = seoDb.deleteSeoPagePlan(created.id);
  assert.equal(result.deleted, true);
  assert.equal(seoDb.getSeoPagePlanById(created.id), null);
});

// --- JSON parse ---

test('JSON parse: 保存したJSON配列/オブジェクトが正しくパースされて返る', () => {
  const task = seedTask('DBテスト 塾 json parse');
  const supportingTask = seedTask('DBテスト 個別指導 json parse');
  const plan = fakePlan(task.id, {
    targetPageId: 'db-test-json-parse',
    groupKey: 'school_page:db-test-json-parse',
    supportingTaskIds: [supportingTask.id],
    supportingKeywords: ['DBテスト 個別指導 json parse'],
    excludedTasks: [{ taskId: 12345, targetKeyword: 'x', reason: 'separate_section_intent' }],
    factCheckSummary: { verified: [{ taskId: supportingTask.id, serviceTerm: 'y', matchedTerms: ['y'], evidenceSources: ['title'] }], unverified: [], conflicting: [] },
  });
  const created = seoDb.upsertSeoPagePlan(plan, nowIso);
  const fetched = seoDb.getSeoPagePlanById(created.id);
  assert.deepEqual(fetched.supporting_task_ids, [supportingTask.id]);
  assert.deepEqual(fetched.excluded_tasks, [{ taskId: 12345, targetKeyword: 'x', reason: 'separate_section_intent' }]);
  assert.equal(fetched.fact_check_summary.verified[0].taskId, supportingTask.id);
});

// --- Validation ---

test('upsertSeoPagePlan: 必須項目欠落は保存しない(エラーを投げる)', () => {
  assert.throws(() => seoDb.upsertSeoPagePlan({ supportingTaskIds: [], excludedTasks: [], warnings: [] }, nowIso), /不正なPage Plan/);
});

test('upsertSeoPagePlan: 不正statusは保存しない', () => {
  const task = seedTask('DBテスト 塾 invalid status save');
  const plan = fakePlan(task.id, { targetPageId: 'db-test-invalid-status-save', groupKey: 'school_page:db-test-invalid-status-save', status: 'in_progress' });
  assert.throws(() => seoDb.upsertSeoPagePlan(plan, nowIso), /不正なPage Plan/);
});

test('upsertSeoPagePlan: primary/supporting重複は保存しない', () => {
  const task = seedTask('DBテスト 塾 dup1');
  const plan = fakePlan(task.id, {
    targetPageId: 'db-test-dup1', groupKey: 'school_page:db-test-dup1', supportingTaskIds: [task.id], supportingKeywords: ['DBテスト 塾 dup1'],
  });
  assert.throws(() => seoDb.upsertSeoPagePlan(plan, nowIso), /不正なPage Plan/);
});

test('upsertSeoPagePlan: supporting/excluded重複は保存しない', () => {
  const task = seedTask('DBテスト 塾 dup2');
  const supportingTask = seedTask('DBテスト 個別指導 dup2');
  const plan = fakePlan(task.id, {
    targetPageId: 'db-test-dup2', groupKey: 'school_page:db-test-dup2',
    supportingTaskIds: [supportingTask.id], supportingKeywords: ['x'],
    excludedTasks: [{ taskId: supportingTask.id, targetKeyword: 'x', reason: 'duplicate_intent', duplicateOf: task.id }],
  });
  assert.throws(() => seoDb.upsertSeoPagePlan(plan, nowIso), /不正なPage Plan/);
});

test('upsertSeoPagePlan: 不正なsource_content_hashは保存しない', () => {
  const task = seedTask('DBテスト 塾 bad hash');
  const plan = fakePlan(task.id, { targetPageId: 'db-test-bad-hash', groupKey: 'school_page:db-test-bad-hash', sourceContentHash: 'not-valid' });
  assert.throws(() => seoDb.upsertSeoPagePlan(plan, nowIso), /不正なPage Plan/);
});

test('upsertSeoPagePlan: duplicateOfが不正なTask IDを指す場合は保存しない', () => {
  const task = seedTask('DBテスト 塾 bad dupof');
  const plan = fakePlan(task.id, {
    targetPageId: 'db-test-bad-dupof', groupKey: 'school_page:db-test-bad-dupof',
    excludedTasks: [{ taskId: 55555, targetKeyword: 'x', reason: 'duplicate_intent', duplicateOf: 88888 }],
  });
  assert.throws(() => seoDb.upsertSeoPagePlan(plan, nowIso), /不正なPage Plan/);
});

test('upsertSeoPagePlan: primary_task_idが実在しない場合は保存しない', () => {
  const plan = fakePlan(999999999, { targetPageId: 'db-test-no-primary-task', groupKey: 'school_page:db-test-no-primary-task' });
  assert.throws(() => seoDb.upsertSeoPagePlan(plan, nowIso), /seo_tasksが存在しません/);
});

// --- 他テーブル不変 ---

test('upsertSeoPagePlan実行前後でseo_tasks/seo_keyword_candidatesの件数が変化しない', () => {
  const conn = getDb();
  const before = {
    tasks: conn.prepare('SELECT COUNT(*) c FROM seo_tasks').get().c,
    candidates: conn.prepare('SELECT COUNT(*) c FROM seo_keyword_candidates').get().c,
  };
  const task = seedTask('DBテスト 塾 unaffected-check-target'); // タスク自体は事前に用意する分は増える
  const afterSeed = {
    tasks: conn.prepare('SELECT COUNT(*) c FROM seo_tasks').get().c,
    candidates: conn.prepare('SELECT COUNT(*) c FROM seo_keyword_candidates').get().c,
  };
  const plan = fakePlan(task.id, { targetPageId: 'db-test-unaffected', groupKey: 'school_page:db-test-unaffected' });
  seoDb.upsertSeoPagePlan(plan, nowIso);
  const afterPlan = {
    tasks: conn.prepare('SELECT COUNT(*) c FROM seo_tasks').get().c,
    candidates: conn.prepare('SELECT COUNT(*) c FROM seo_keyword_candidates').get().c,
  };
  // Page Plan保存自体はseo_tasks/seo_keyword_candidatesを増減させない
  assert.deepEqual(afterPlan, afterSeed);
  assert.equal(afterSeed.tasks, before.tasks + 1);
  assert.equal(afterSeed.candidates, before.candidates + 1);
});

test('upsertSeoPagePlan実行前後でTask statusが変わらない', () => {
  const task = seedTask('DBテスト 塾 status-unaffected');
  const plan = fakePlan(task.id, { targetPageId: 'db-test-status-unaffected', groupKey: 'school_page:db-test-status-unaffected' });
  seoDb.upsertSeoPagePlan(plan, nowIso);
  const conn = getDb();
  const row = conn.prepare('SELECT status FROM seo_tasks WHERE id = ?').get(task.id);
  assert.equal(row.status, 'proposed');
});
