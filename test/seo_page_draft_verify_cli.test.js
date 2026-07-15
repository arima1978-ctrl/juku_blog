'use strict';

// Sprint 3.6: scripts/seo_page_draft_verify.jsのテスト。DB書き込みなし。

const os = require('node:os');
const path = require('node:path');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_page_draft_verify_cli_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { ROOT } = require('../scripts/lib/config');
const { closeDb, getDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');
const { resolveDraftVerify } = require('../scripts/seo_page_draft_verify');

const TMP_RESULT = path.join(os.tmpdir(), `juku_blog_page_draft_verify_result_${process.pid}.json`);

after(() => {
  closeDb();
  try {
    fs.unlinkSync(process.env.JUKU_BLOG_DB_PATH);
  } catch {
    // 既に無ければ無視
  }
  try {
    fs.unlinkSync(TMP_RESULT);
  } catch {
    // 既に無ければ無視
  }
});

const nowIso = '2026-07-16T00:00:00.000Z';

function seedApprovedPlanWithSupporting(pageId) {
  const primaryCandidate = seoDb.upsertKeywordCandidate(
    { normalized_keyword: 'VerifyCLIテスト 塾', target_area: 'x', gap_type: 'weak', priority_score: 70, data_confidence: 75 },
    nowIso
  );
  const primaryTask = seoDb.upsertTask(
    {
      task_type: 'improve_school_page', target_keyword: 'VerifyCLIテスト 塾', source_candidate_id: primaryCandidate.id,
      opportunity_score: 74, recommended_action: 'improve_school_page',
      target_url: `https://an-english.com/school/${pageId}/`, target_page_type: 'school_page',
      target_page_id: pageId, target_page_name: 'VerifyCLIテスト教室', reason: ['school_page_template'],
    },
    nowIso
  );
  const supportingCandidate = seoDb.upsertKeywordCandidate(
    { normalized_keyword: 'VerifyCLIテスト 個別指導', target_area: 'x', gap_type: 'shared', priority_score: 70, data_confidence: 60 },
    nowIso
  );
  const supportingTask = seoDb.upsertTask(
    {
      task_type: 'improve_school_page', target_keyword: 'VerifyCLIテスト 個別指導', source_candidate_id: supportingCandidate.id,
      opportunity_score: 70, recommended_action: 'improve_school_page',
      target_url: `https://an-english.com/school/${pageId}/`, target_page_type: 'school_page',
      target_page_id: pageId, target_page_name: 'VerifyCLIテスト教室', reason: ['school_page_template'],
    },
    nowIso
  );
  const plan = seoDb.upsertSeoPagePlan(
    {
      groupKey: `school_page:${pageId}`, targetPageType: 'school_page', targetPageId: pageId,
      targetPageName: 'VerifyCLIテスト教室', targetUrl: `https://an-english.com/school/${pageId}/`,
      primaryTaskId: primaryTask.id, primaryKeyword: 'VerifyCLIテスト 塾',
      supportingTaskIds: [supportingTask.id], supportingKeywords: ['VerifyCLIテスト 個別指導'],
      excludedTasks: [{ taskId: 999, targetKeyword: '除外キーワード', reason: 'duplicate_intent' }],
      combinedSearchIntents: ['general_service'],
      selectionBreakdown: {},
      factCheckSummary: { verified: [{ taskId: supportingTask.id, serviceTerm: '個別指導', matchedTerms: ['個別指導'], evidenceSources: ['title'] }], unverified: [], conflicting: [] },
      warnings: [], sourceContentHash: 'a'.repeat(64), promptVersion: null, status: 'proposed',
    },
    nowIso
  );
  seoDb.transitionSeoPagePlanStatus({ pagePlanId: plan.id, expectedCurrentStatus: 'proposed', nextStatus: 'reviewing', actor: 'setup', source: 'cli' }, nowIso);
  seoDb.transitionSeoPagePlanStatus({ pagePlanId: plan.id, expectedCurrentStatus: 'reviewing', nextStatus: 'approved', actor: 'setup', source: 'cli' }, nowIso);
  return { planId: plan.id, primaryTaskId: primaryTask.id, supportingTaskId: supportingTask.id };
}

test('CLI: growth_director.enabled=false(既定)なら無処理で終了する', () => {
  const output = execFileSync('node', [path.join(ROOT, 'scripts', 'seo_page_draft_verify.js'), '--input=x', '--plan-id=1'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(output, /無処理で終了/);
});

test('resolveDraftVerify: 正常なresultはvalid=true', () => {
  const { planId, primaryTaskId, supportingTaskId } = seedApprovedPlanWithSupporting('verify-valid');
  fs.writeFileSync(
    TMP_RESULT,
    JSON.stringify({
      can_generate: true,
      summary: '導入文追加',
      suggested_location: '見出し直後',
      generated_text: 'テスト教室は地域密着で個別指導を行っています。',
      change_reason: 'テスト理由',
      search_intent_alignment: 'テスト整合性',
      covered_task_ids: [primaryTaskId, supportingTaskId],
      covered_keywords: ['VerifyCLIテスト 塾', 'VerifyCLIテスト 個別指導'],
      excluded_task_ids: [],
      excluded_intents: [],
      warnings: [],
    }),
    'utf8'
  );
  const result = resolveDraftVerify({ inputPath: TMP_RESULT, planId });
  assert.equal(result.valid, true);
});

test('resolveDraftVerify: Excluded Task IDがcoveredに混入していればinvalid', () => {
  const { planId, primaryTaskId } = seedApprovedPlanWithSupporting('verify-excluded-covered');
  fs.writeFileSync(
    TMP_RESULT,
    JSON.stringify({
      can_generate: true,
      summary: '導入文追加',
      suggested_location: '見出し直後',
      generated_text: 'テスト教室は地域密着で指導を行っています。',
      change_reason: 'テスト理由',
      search_intent_alignment: 'テスト整合性',
      covered_task_ids: [primaryTaskId, 999], // 999は除外Task
      covered_keywords: [],
      excluded_task_ids: [],
      excluded_intents: [],
      warnings: [],
    }),
    'utf8'
  );
  const result = resolveDraftVerify({ inputPath: TMP_RESULT, planId });
  assert.equal(result.valid, false);
});

test('resolveDraftVerify: 存在しないPlan IDはinvalid(該当メッセージ)', () => {
  const result = resolveDraftVerify({ inputPath: TMP_RESULT, planId: 999999 });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('見つかりません')));
});

test('resolveDraftVerify: 不正なJSONファイルはinvalid', () => {
  fs.writeFileSync(TMP_RESULT, 'not valid json{{{', 'utf8');
  const { planId } = seedApprovedPlanWithSupporting('verify-bad-json');
  const result = resolveDraftVerify({ inputPath: TMP_RESULT, planId });
  assert.equal(result.valid, false);
});

test('DBを書き換えない: resolveDraftVerify実行前後でDB件数が変化しない', () => {
  const conn = getDb();
  const { planId, primaryTaskId } = seedApprovedPlanWithSupporting('verify-db-unaffected');
  fs.writeFileSync(
    TMP_RESULT,
    JSON.stringify({
      can_generate: true, summary: 'テスト', suggested_location: 'テスト', generated_text: 'テスト本文です。',
      change_reason: 'テスト', search_intent_alignment: 'テスト',
      covered_task_ids: [primaryTaskId], covered_keywords: [], excluded_task_ids: [], excluded_intents: [], warnings: [],
    }),
    'utf8'
  );
  const before = {
    plans: conn.prepare('SELECT COUNT(*) c FROM seo_page_plans').get().c,
    drafts: conn.prepare('SELECT COUNT(*) c FROM seo_page_drafts').get().c,
  };
  resolveDraftVerify({ inputPath: TMP_RESULT, planId });
  const after1 = {
    plans: conn.prepare('SELECT COUNT(*) c FROM seo_page_plans').get().c,
    drafts: conn.prepare('SELECT COUNT(*) c FROM seo_page_drafts').get().c,
  };
  assert.deepEqual(after1, before);
});
