'use strict';

// Sprint 3.6: scripts/seo_page_draft_preview.js(approved Planのみ生成対象・stale判定)のテスト。
// fakeテストでは実通信禁止のため、pageContextDepsを注入する。

const os = require('node:os');
const path = require('node:path');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_page_draft_preview_cli_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const yaml = require('js-yaml');
const { ROOT } = require('../scripts/lib/config');
const { closeDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');
const { resolveDraftPreview } = require('../scripts/seo_page_draft_preview');

// growth_director.enabled=false(既定)時の挙動を検証するテストは、実configの現在値
// (本番アクティベーション後はtrue)に依存せず安定して再現するため、一時configを使う。
function writeDisabledGrowthDirectorConfig(tmpConfigPath) {
  const config = yaml.load(fs.readFileSync(path.join(ROOT, 'config', 'juku.yaml'), 'utf8'));
  config.features.growth_director.enabled = false;
  fs.writeFileSync(tmpConfigPath, yaml.dump(config), 'utf8');
  return tmpConfigPath;
}

const TMP_DISABLED_CONFIG = path.join(os.tmpdir(), `juku_blog_page_draft_preview_disabled_config_${process.pid}.yaml`);
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
const DUMMY_URL = 'https://an-english.com/school/draft-preview-cli-fixture/';

function fakePageContextDeps({ contentHash = 'a'.repeat(64), title = 'テスト教室 - 個別指導塾', headings = [], bodyExcerpt = '本文' } = {}) {
  return {
    getSchoolPage: (url) => (url === DUMMY_URL ? { id: 'draft-preview-cli-fixture', url: DUMMY_URL } : null),
    listSchoolPages: () => [{ url: DUMMY_URL }],
    loadConfig: () => ({ seo: { competitor_analysis: { user_agent: 'ua', request_timeout_ms: 1000, request_interval_ms: 0, max_retries: 0 } } }),
    fetchPage: async () => ({ status: 'fetched', url: DUMMY_URL, finalUrl: DUMMY_URL, title, headings, bodyExcerpt, fetchedAt: nowIso, contentHash }),
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

function seedPlan(pageId, { status = 'approved', sourceContentHash = 'a'.repeat(64) } = {}) {
  const candidate = seoDb.upsertKeywordCandidate(
    { normalized_keyword: `PreviewCLIテスト ${pageId}`, target_area: 'x', gap_type: 'weak', priority_score: 70, data_confidence: 75 },
    nowIso
  );
  const task = seoDb.upsertTask(
    {
      task_type: 'improve_school_page', target_keyword: `PreviewCLIテスト ${pageId}`, source_candidate_id: candidate.id,
      opportunity_score: 74, recommended_action: 'improve_school_page',
      target_url: DUMMY_URL, target_page_type: 'school_page', target_page_id: pageId,
      target_page_name: 'PreviewCLIテスト教室', reason: ['school_page_template'],
    },
    nowIso
  );
  const plan = seoDb.upsertSeoPagePlan(
    {
      groupKey: `school_page:${pageId}`, targetPageType: 'school_page', targetPageId: pageId,
      targetPageName: 'PreviewCLIテスト教室', targetUrl: DUMMY_URL,
      primaryTaskId: task.id, primaryKeyword: `PreviewCLIテスト ${pageId}`,
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
  return plan.id;
}

test('CLI: growth_director.enabled=false(既定)なら無処理で終了する', () => {
  const output = execFileSync('node', [path.join(ROOT, 'scripts', 'seo_page_draft_preview.js'), '--plan-id=1'], { cwd: ROOT, encoding: 'utf8', env: disabledEnv });
  assert.match(output, /無処理で終了/);
});

test('resolveDraftPreview: reviewing Planはpage_plan_not_approvedで拒否される', async () => {
  const planId = seedPlan('preview-reviewing', { status: 'reviewing' });
  const result = await resolveDraftPreview({ planId, pageContextDeps: unfetchablePageContextDeps() });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'page_plan_not_approved');
});

test('resolveDraftPreview: rejected Planはpage_plan_not_approvedで拒否される', async () => {
  const planId = seedPlan('preview-rejected', { status: 'rejected' });
  const result = await resolveDraftPreview({ planId, pageContextDeps: unfetchablePageContextDeps() });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'page_plan_not_approved');
});

test('resolveDraftPreview: proposed Planはpage_plan_not_approvedで拒否される', async () => {
  const planId = seedPlan('preview-proposed', { status: 'proposed' });
  const result = await resolveDraftPreview({ planId, pageContextDeps: unfetchablePageContextDeps() });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'page_plan_not_approved');
});

test('resolveDraftPreview: approved Planでpage_context取得不可はpage_context_not_available', async () => {
  const planId = seedPlan('preview-no-context', { status: 'approved' });
  const result = await resolveDraftPreview({ planId, pageContextDeps: unfetchablePageContextDeps() });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'page_context_not_available');
});

test('resolveDraftPreview: approved Planでcontent hash不一致はpage_plan_content_stale', async () => {
  const planId = seedPlan('preview-stale', { status: 'approved', sourceContentHash: 'a'.repeat(64) });
  const result = await resolveDraftPreview({ planId, pageContextDeps: fakePageContextDeps({ contentHash: 'b'.repeat(64) }) });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'page_plan_content_stale');
});

test('resolveDraftPreview: approved Planでhash一致ならPrompt生成できる', async () => {
  const planId = seedPlan('preview-approved-ok', { status: 'approved', sourceContentHash: 'a'.repeat(64) });
  const result = await resolveDraftPreview({ planId, pageContextDeps: fakePageContextDeps({ contentHash: 'a'.repeat(64) }) });
  assert.equal(result.ok, true);
  assert.equal(result.promptVersion, 'page-draft-v1');
  assert.match(result.prompt, /PreviewCLIテスト preview-approved-ok/);
});

test('resolveDraftPreview: 存在しないPlan IDはnot_found', async () => {
  const result = await resolveDraftPreview({ planId: 999999, pageContextDeps: unfetchablePageContextDeps() });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'not_found');
});

test('外部通信・WordPress・LLM呼び出しが無いこと', () => {
  const files = [
    path.join(ROOT, 'scripts', 'seo_page_draft_preview.js'),
    path.join(ROOT, 'scripts', 'lib', 'seo', 'page_draft_prompt_builder.js'),
  ];
  files.forEach((f) => {
    const content = fs.readFileSync(f, 'utf8');
    assert.ok(!/require\(['"]https?['"]\)/.test(content));
    assert.ok(!/require\(['"](openai|@anthropic-ai|@google\/generative-ai)['"]\)/i.test(content));
    assert.ok(!/wp-json/.test(content));
    assert.ok(!/fetch\(/.test(content));
    assert.ok(!/claude\s+-p/.test(content));
  });
});
