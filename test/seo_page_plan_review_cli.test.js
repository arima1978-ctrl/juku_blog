'use strict';

// Sprint 3.5: scripts/seo_page_plan_review.js(dry-run既定・--save明示時のみ変更)のテスト。
// 保存テストは必ず一時SQLite(JUKU_BLOG_DB_PATH)で行い、実データ(data/posts.sqlite)は使わない。

const os = require('node:os');
const path = require('node:path');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_page_plan_review_cli_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const yaml = require('js-yaml');
const { ROOT } = require('../scripts/lib/config');
const { closeDb, getDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');
const { resolvePagePlanReview, parseArgs, formatText } = require('../scripts/seo_page_plan_review');

// growth_director.enabled=false(既定)時の挙動を検証するテストは、実configの現在値
// (本番アクティベーション後はtrue)に依存せず安定して再現するため、一時configを使う。
function writeDisabledGrowthDirectorConfig(tmpConfigPath) {
  const config = yaml.load(fs.readFileSync(path.join(ROOT, 'config', 'juku.yaml'), 'utf8'));
  config.features.growth_director.enabled = false;
  fs.writeFileSync(tmpConfigPath, yaml.dump(config), 'utf8');
  return tmpConfigPath;
}

const TMP_DISABLED_CONFIG = path.join(os.tmpdir(), `juku_blog_page_plan_review_disabled_config_${process.pid}.yaml`);
writeDisabledGrowthDirectorConfig(TMP_DISABLED_CONFIG);
const disabledEnv = { ...process.env, JUKU_BLOG_CONFIG_PATH: TMP_DISABLED_CONFIG };

after(() => {
  closeDb();
  [process.env.JUKU_BLOG_DB_PATH, TMP_DISABLED_CONFIG].forEach((f) => {
    try {
      fs.unlinkSync(f);
    } catch {
      // 既に無ければ無視
    }
  });
});

const nowIso = '2026-07-16T00:00:00.000Z';

function seedPlan(pageId, status = 'proposed') {
  const candidate = seoDb.upsertKeywordCandidate(
    { normalized_keyword: `CLIレビューテスト ${pageId}`, target_area: 'x', gap_type: 'weak', priority_score: 70, data_confidence: 70 },
    nowIso
  );
  const task = seoDb.upsertTask(
    {
      task_type: 'improve_school_page',
      target_keyword: `CLIレビューテスト ${pageId}`,
      source_candidate_id: candidate.id,
      opportunity_score: 70,
      recommended_action: 'improve_school_page',
      target_url: `https://an-english.com/school/${pageId}/`,
      target_page_type: 'school_page',
      target_page_id: pageId,
      target_page_name: 'CLIレビューテスト教室',
      reason: ['school_page_template'],
    },
    nowIso
  );
  const plan = seoDb.upsertSeoPagePlan(
    {
      groupKey: `school_page:${pageId}`,
      targetPageType: 'school_page',
      targetPageId: pageId,
      targetPageName: 'CLIレビューテスト教室',
      targetUrl: `https://an-english.com/school/${pageId}/`,
      primaryTaskId: task.id,
      primaryKeyword: `CLIレビューテスト ${pageId}`,
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
  if (status !== 'proposed') {
    seoDb.transitionSeoPagePlanStatus({ pagePlanId: plan.id, expectedCurrentStatus: 'proposed', nextStatus: 'reviewing', actor: 'setup', source: 'cli' }, nowIso);
    if (status !== 'reviewing') {
      seoDb.transitionSeoPagePlanStatus({ pagePlanId: plan.id, expectedCurrentStatus: 'reviewing', nextStatus: status, actor: 'setup', reason: status === 'rejected' ? '準備' : undefined, source: 'cli' }, nowIso);
    }
  }
  return plan.id;
}

test('CLI: growth_director.enabled=false(既定)なら無処理で終了する', () => {
  const output = execFileSync('node', [path.join(ROOT, 'scripts', 'seo_page_plan_review.js'), '--dry-run'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: disabledEnv,
  });
  assert.match(output, /無処理で終了/);
});

test('resolvePagePlanReview: dry-run(save=false)ではDBへ保存しない', () => {
  const planId = seedPlan('cli-dry-run');
  const result = resolvePagePlanReview({ planId, expectedStatus: 'proposed', nextStatus: 'reviewing', actor: 'admin', reason: '確認開始', save: false });
  assert.equal(result.ok, true);
  assert.equal(result.saved, false);
  const plan = seoDb.getSeoPagePlanById(planId);
  assert.equal(plan.status, 'proposed'); // 変わっていない
  assert.equal(seoDb.listSeoPagePlanReviews(planId).length, 0); // 履歴も追加されない
});

test('resolvePagePlanReview: --save相当(save=true)で一時SQLiteへ保存できる', () => {
  const planId = seedPlan('cli-save');
  const result = resolvePagePlanReview({ planId, expectedStatus: 'proposed', nextStatus: 'reviewing', actor: 'admin', reason: '確認開始', save: true });
  assert.equal(result.ok, true);
  assert.equal(result.saved, true);
  const plan = seoDb.getSeoPagePlanById(planId);
  assert.equal(plan.status, 'reviewing');
  assert.equal(seoDb.listSeoPagePlanReviews(planId).length, 1);
});

test('parseArgs: --dry-runと--saveの両方指定を検出できる', () => {
  const args = parseArgs(['--dry-run', '--save']);
  assert.equal(args.dryRun, true);
  assert.equal(args.save, true);
});

test('resolvePagePlanReview: オプション既定(save省略)はdry-run相当(save=false)', () => {
  const planId = seedPlan('cli-default-dry-run');
  const result = resolvePagePlanReview({ planId, expectedStatus: 'proposed', nextStatus: 'reviewing', actor: 'admin' });
  assert.equal(result.saved, false);
});

test('resolvePagePlanReview: 存在しないPlan IDはnot_found', () => {
  const result = resolvePagePlanReview({ planId: 999999, expectedStatus: 'proposed', nextStatus: 'reviewing', actor: 'admin', save: false });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'not_found');
});

test('resolvePagePlanReview: expected statusとDB上のstatusが不一致ならconflict(save=falseでも検出)', () => {
  const planId = seedPlan('cli-conflict');
  const result = resolvePagePlanReview({ planId, expectedStatus: 'reviewing', nextStatus: 'approved', actor: 'admin', save: false });
  assert.equal(result.ok, false);
  assert.equal(result.conflict, true);
  assert.equal(result.errorCode, 'page_plan_status_conflict');
});

test('resolvePagePlanReview: 不正な遷移(proposed→approved)はdry-runでも検出される', () => {
  const planId = seedPlan('cli-invalid-transition');
  const result = resolvePagePlanReview({ planId, expectedStatus: 'proposed', nextStatus: 'approved', actor: 'admin', save: false });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'invalid_transition');
});

test('resolvePagePlanReview: reason必須の遷移でreason未指定はdry-runでも検出される', () => {
  const planId = seedPlan('cli-reason-required');
  const result = resolvePagePlanReview({ planId, expectedStatus: 'proposed', nextStatus: 'rejected', actor: 'admin', save: false });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'invalid_transition');
});

test('CLI --format=text: テキスト形式で出力できる', () => {
  const planId = seedPlan('cli-format-text');
  const result = resolvePagePlanReview({ planId, expectedStatus: 'proposed', nextStatus: 'reviewing', actor: 'admin', save: false });
  const text = formatText(result);
  assert.match(text, /planId:/);
  assert.match(text, /currentStatus:/);
});

test('DB非更新dry-run: resolvePagePlanReview(save=false)実行前後でPage Plan/review/Task/Candidate件数が変化しない', () => {
  const conn = getDb();
  const planId = seedPlan('cli-db-unaffected');
  const before = {
    plans: conn.prepare('SELECT COUNT(*) c FROM seo_page_plans').get().c,
    reviews: conn.prepare('SELECT COUNT(*) c FROM seo_page_plan_reviews').get().c,
    tasks: conn.prepare('SELECT COUNT(*) c FROM seo_tasks').get().c,
    candidates: conn.prepare('SELECT COUNT(*) c FROM seo_keyword_candidates').get().c,
  };
  resolvePagePlanReview({ planId, expectedStatus: 'proposed', nextStatus: 'reviewing', actor: 'admin', save: false });
  const after1 = {
    plans: conn.prepare('SELECT COUNT(*) c FROM seo_page_plans').get().c,
    reviews: conn.prepare('SELECT COUNT(*) c FROM seo_page_plan_reviews').get().c,
    tasks: conn.prepare('SELECT COUNT(*) c FROM seo_tasks').get().c,
    candidates: conn.prepare('SELECT COUNT(*) c FROM seo_keyword_candidates').get().c,
  };
  assert.deepEqual(after1, before);
});

test('外部通信・WordPress・LLM呼び出しが無いこと: 対象ファイルにネットワーク/API呼び出しの記述が無い', () => {
  const files = [
    path.join(ROOT, 'scripts', 'seo_page_plan_review.js'),
    path.join(ROOT, 'scripts', 'lib', 'seo', 'page_plan_review.js'),
  ];
  files.forEach((f) => {
    const content = fs.readFileSync(f, 'utf8');
    assert.ok(!/require\(['"]https?['"]\)/.test(content), `${f} にnode:https/http requireが含まれています`);
    assert.ok(!/require\(['"]node:https['"]\)/.test(content), `${f} にnode:https requireが含まれています`);
    assert.ok(!/require\(['"](openai|@anthropic-ai|@google\/generative-ai)['"]\)/i.test(content), `${f} にLLM SDKのrequireが含まれています`);
    assert.ok(!/wp-json/.test(content), `${f} にWordPress API参照が含まれています`);
    assert.ok(!/fetch\(/.test(content), `${f} にfetch()呼び出しが含まれています`);
    assert.ok(!/claude\s+-p/.test(content), `${f} にClaude subagent実行の記述が含まれています`);
  });
});
