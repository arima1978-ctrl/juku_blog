'use strict';

// Sprint 3.7: scripts/seo_page_plan_regenerate.js(stale Page Plan再生成CLI)のテスト。
// fakeテストでは実通信禁止のため、pageContextDeps/enrichedTasksProviderを注入する。
// 必ず一時SQLite(JUKU_BLOG_DB_PATH)を使い、実データ(data/posts.sqlite)は一切変更しない。

const os = require('node:os');
const path = require('node:path');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_page_plan_regenerate_cli_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const yaml = require('js-yaml');
const { ROOT } = require('../scripts/lib/config');
const { closeDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');
const { resolveStalePagePlanRegenerate, parseArgs, formatText } = require('../scripts/seo_page_plan_regenerate');

// growth_director.enabled=false(既定)時の挙動を検証するテストは、実configの現在値
// (本番アクティベーション後はtrue)に依存せず安定して再現するため、一時configを使う。
function writeDisabledGrowthDirectorConfig(tmpConfigPath) {
  const config = yaml.load(fs.readFileSync(path.join(ROOT, 'config', 'juku.yaml'), 'utf8'));
  config.features.growth_director.enabled = false;
  fs.writeFileSync(tmpConfigPath, yaml.dump(config), 'utf8');
  return tmpConfigPath;
}

const TMP_DISABLED_CONFIG = path.join(os.tmpdir(), `juku_blog_page_plan_regenerate_disabled_config_${process.pid}.yaml`);
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

const nowIso = '2026-07-18T00:00:00.000Z';
const OLD_HASH = 'a'.repeat(64);
const NEW_HASH = 'b'.repeat(64);

function fakePageContextDeps({ url, contentHash = NEW_HASH } = {}) {
  return {
    getSchoolPage: (u) => (u === url ? { id: 'regen-cli-fixture', url } : null),
    listSchoolPages: () => [{ url }],
    loadConfig: () => ({ seo: { competitor_analysis: { user_agent: 'ua', request_timeout_ms: 1000, request_interval_ms: 0, max_retries: 0 } } }),
    fetchPage: async () => ({ status: 'fetched', url, finalUrl: url, title: 'title', headings: [], bodyExcerpt: '', fetchedAt: nowIso, contentHash }),
  };
}

function unfetchablePageContextDeps() {
  return {
    getSchoolPage: () => null,
    listSchoolPages: () => [],
    loadConfig: () => ({ seo: { competitor_analysis: { user_agent: 'ua', request_timeout_ms: 1000, request_interval_ms: 0, max_retries: 0 } } }),
    fetchPage: async () => {
      throw new Error('fetchPageが呼ばれてはいけない');
    },
  };
}

function seedTaskAndPlan(pageId, { status = 'approved', sourceContentHash = OLD_HASH } = {}) {
  const url = `https://an-english.com/school/${pageId}/`;
  const candidate = seoDb.upsertKeywordCandidate(
    { normalized_keyword: `再生成CLIテスト ${pageId}`, target_area: 'x', gap_type: 'weak', priority_score: 70, data_confidence: 70, search_intent: 'general_service', template_type: 'area_juku' },
    nowIso
  );
  const task = seoDb.upsertTask(
    {
      task_type: 'improve_school_page',
      target_keyword: `再生成CLIテスト ${pageId}`,
      source_candidate_id: candidate.id,
      opportunity_score: 70,
      recommended_action: 'improve_school_page',
      target_url: url,
      target_page_type: 'school_page',
      target_page_id: pageId,
      target_page_name: '再生成CLIテスト教室',
      reason: ['school_page_template'],
    },
    nowIso
  );
  const plan = seoDb.upsertSeoPagePlan(
    {
      groupKey: `school_page:${pageId}`,
      targetPageType: 'school_page',
      targetPageId: pageId,
      targetPageName: '再生成CLIテスト教室',
      targetUrl: url,
      primaryTaskId: task.id,
      primaryKeyword: `再生成CLIテスト ${pageId}`,
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
  return { planId: plan.id, taskId: task.id, url };
}

function enrichedTasksProviderFor(task) {
  return () => [
    {
      taskId: task.id,
      status: 'proposed',
      taskType: 'improve_school_page',
      targetUrl: task.target_url,
      targetPageType: task.target_page_type,
      targetPageId: task.target_page_id,
      targetPageName: task.target_page_name,
      targetKeyword: task.target_keyword,
      opportunityScore: task.opportunity_score,
      sourceCandidateId: task.source_candidate_id,
      gapType: 'weak',
      dataConfidence: 70,
      searchIntent: 'general_service',
      templateType: 'area_juku',
      keywordComponents: null,
      gscImpressions: null,
      gscAvgPosition: null,
    },
  ];
}

test('CLI: growth_director.enabled=false(既定)なら無処理で終了する', () => {
  const output = execFileSync(
    'node',
    [path.join(ROOT, 'scripts', 'seo_page_plan_regenerate.js'), '--plan-id=1', '--expected-status=approved', '--actor=admin', '--reason=x'],
    { cwd: ROOT, encoding: 'utf8', env: disabledEnv }
  );
  assert.match(output, /無処理で終了/);
});

test('parseArgs: --dry-runと--saveの両方指定を検出できる', () => {
  const args = parseArgs(['--plan-id=1', '--expected-status=approved', '--actor=admin', '--reason=x', '--dry-run', '--save']);
  assert.equal(args.dryRun, true);
  assert.equal(args.save, true);
});

test('resolveStalePagePlanRegenerate: 存在しないPlan IDはnot_found', async () => {
  const result = await resolveStalePagePlanRegenerate({ planId: 999999, expectedStatus: 'approved', actor: 'admin', reason: 'x', save: false });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'not_found');
});

test('resolveStalePagePlanRegenerate: expected statusとDB上のstatusが不一致ならconflict(save=falseでも検出)', async () => {
  const { planId, taskId } = seedTaskAndPlan('regen-cli-conflict', { status: 'approved' });
  const task = seoDb.getTaskById(taskId);
  const result = await resolveStalePagePlanRegenerate({
    planId,
    expectedStatus: 'reviewing', // 実際はapproved
    actor: 'admin',
    reason: 'x',
    save: false,
    pageContextDeps: unfetchablePageContextDeps(),
    enrichedTasksProvider: enrichedTasksProviderFor(task),
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'page_plan_status_conflict');
  assert.equal(result.saved, false);
});

test('resolveStalePagePlanRegenerate: pageContext取得失敗はpage_context_not_availableでDB変更なし', async () => {
  const { planId, taskId } = seedTaskAndPlan('regen-cli-unfetchable', { status: 'approved' });
  const task = seoDb.getTaskById(taskId);
  const before = seoDb.getSeoPagePlanById(planId);

  const result = await resolveStalePagePlanRegenerate({
    planId,
    expectedStatus: 'approved',
    actor: 'admin',
    reason: 'x',
    save: true, // saveを指定してもpageContext取得失敗時はDBへ触れないことを確認
    pageContextDeps: { getSchoolPage: () => null, listSchoolPages: () => [], loadConfig: () => ({ seo: { competitor_analysis: { user_agent: 'ua', request_timeout_ms: 1000, request_interval_ms: 0, max_retries: 0 } } }), fetchPage: async () => ({ status: 'blocked_ssrf' }) },
    enrichedTasksProvider: enrichedTasksProviderFor(task),
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'page_context_not_available');
  assert.equal(result.saved, false);

  const after = seoDb.getSeoPagePlanById(planId);
  assert.equal(after.status, before.status);
  assert.equal(after.updated_at, before.updated_at);
});

test('resolveStalePagePlanRegenerate: hash一致時はstale=falseで再生成不要と報告する(DB変更なし)', async () => {
  const { planId, taskId, url } = seedTaskAndPlan('regen-cli-not-stale', { status: 'approved', sourceContentHash: NEW_HASH });
  const task = seoDb.getTaskById(taskId);
  const before = seoDb.getSeoPagePlanById(planId);

  const result = await resolveStalePagePlanRegenerate({
    planId,
    expectedStatus: 'approved',
    actor: 'admin',
    reason: 'x',
    save: true,
    pageContextDeps: fakePageContextDeps({ url, contentHash: NEW_HASH }), // hash一致
    enrichedTasksProvider: enrichedTasksProviderFor(task),
  });
  assert.equal(result.ok, true);
  assert.equal(result.stale, false);
  assert.equal(result.saved, false);

  const after = seoDb.getSeoPagePlanById(planId);
  assert.equal(after.status, before.status);
  assert.equal(after.updated_at, before.updated_at);
});

test('resolveStalePagePlanRegenerate: dry-run(save=false)ではhash不一致でもDBへ保存しない', async () => {
  const { planId, taskId, url } = seedTaskAndPlan('regen-cli-dry-run', { status: 'approved', sourceContentHash: OLD_HASH });
  const task = seoDb.getTaskById(taskId);
  const before = seoDb.getSeoPagePlanById(planId);
  const beforeReviewCount = seoDb.listSeoPagePlanReviews(planId).length;

  const result = await resolveStalePagePlanRegenerate({
    planId,
    expectedStatus: 'approved',
    actor: 'admin',
    reason: '本文変更のため',
    save: false,
    pageContextDeps: fakePageContextDeps({ url, contentHash: NEW_HASH }),
    enrichedTasksProvider: enrichedTasksProviderFor(task),
  });

  assert.equal(result.ok, true);
  assert.equal(result.stale, true);
  assert.equal(result.staleReason, 'content_hash_mismatch');
  assert.equal(result.previousContentHash, OLD_HASH);
  assert.equal(result.currentContentHash, NEW_HASH);
  assert.ok(result.regeneratedPlan);
  assert.ok(result.changes);
  assert.equal(result.saved, false);

  const after = seoDb.getSeoPagePlanById(planId);
  assert.equal(after.status, before.status); // approvedのまま
  assert.equal(after.updated_at, before.updated_at);
  assert.equal(after.source_content_hash, OLD_HASH); // 内容も変更されていない
  assert.equal(seoDb.listSeoPagePlanReviews(planId).length, beforeReviewCount); // 履歴も追加されない
});

test('resolveStalePagePlanRegenerate: --save相当(save=true)で一時SQLiteへ保存し、proposedへ戻る', async () => {
  const { planId, taskId, url } = seedTaskAndPlan('regen-cli-save', { status: 'approved', sourceContentHash: OLD_HASH });
  const task = seoDb.getTaskById(taskId);

  const result = await resolveStalePagePlanRegenerate({
    planId,
    expectedStatus: 'approved',
    actor: 'admin',
    reason: '本文変更のため',
    save: true,
    pageContextDeps: fakePageContextDeps({ url, contentHash: NEW_HASH }),
    enrichedTasksProvider: enrichedTasksProviderFor(task),
  });

  assert.equal(result.ok, true);
  assert.equal(result.saved, true);
  assert.equal(result.saveResult.finalStatus, 'proposed');

  const after = seoDb.getSeoPagePlanById(planId);
  assert.equal(after.status, 'proposed');
  assert.equal(after.source_content_hash, NEW_HASH);
});

test('CLI --format=text: テキスト形式で出力できる', async () => {
  const result = { ok: true, pagePlanId: 1, currentStatus: 'approved', stale: true, saved: false, staleReason: 'content_hash_mismatch', previousContentHash: OLD_HASH, currentContentHash: NEW_HASH, changes: { primaryChanged: false, supportingChanged: false, excludedChanged: false } };
  const text = formatText(result);
  assert.match(text, /ok: true/);
  assert.match(text, /stale: true/);
});

test('外部通信・WordPress・LLM呼び出しが無いこと: 対象ファイルにネットワーク/API呼び出しの記述が無い', () => {
  const files = [
    path.join(ROOT, 'scripts', 'seo_page_plan_regenerate.js'),
    path.join(ROOT, 'scripts', 'lib', 'seo', 'page_plan_staleness.js'),
    path.join(ROOT, 'scripts', 'lib', 'seo', 'stale_page_plan_regenerator.js'),
  ];
  files.forEach((f) => {
    const content = fs.readFileSync(f, 'utf8');
    assert.ok(!/require\(['"]https?['"]\)/.test(content), `${f} にnode:https/http requireが含まれています`);
    assert.ok(!/require\(['"]node:https['"]\)/.test(content), `${f} にnode:https requireが含まれています`);
    assert.ok(!/require\(['"](openai|@anthropic-ai|@google\/generative-ai)['"]\)/i.test(content), `${f} にLLM SDKのrequireが含まれています`);
    assert.ok(!/wp-json/.test(content), `${f} にWordPress API参照が含まれています`);
    assert.ok(!/fetch\(/.test(content), `${f} にfetch()呼び出しが含まれています`);
    assert.ok(!/claude\s+-p/.test(content), `${f} にClaude subagent実行の記述が含まれています`);
    assert.ok(!/child_process|spawn\(|execSync\(|execFileSync\(/.test(content), `${f} にプロセス起動の記述が含まれています`);
  });
});
