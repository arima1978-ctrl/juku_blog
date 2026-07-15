'use strict';

// Sprint 3.5: /api/seo/page-plans(読み取り専用)のテスト。
// api-server.jsを子プロセスで起動し、一時DB・専用ポートを使う(本番data/posts.sqliteや
// PORT 3013には触れない)。Feature Flag ON時の挙動は、JUKU_BLOG_CONFIG_PATH経由で
// 一時configファイルを注入して検証する(共有のconfig/juku.yamlは書き換えない)。
// status変更API(POST /transition)は安全性の理由から今回実装していないため、
// このテストファイルは読み取りエンドポイントのみを対象とする。

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ROOT } = require('../scripts/lib/config');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_page_plan_api_test_${process.pid}.sqlite`);
const TMP_CONFIG_ENABLED = path.join(os.tmpdir(), `juku_blog_page_plan_api_config_enabled_${process.pid}.yaml`);
const PORT_DISABLED = 34214; // Feature Flag OFF(既定config)検証用
const PORT_ENABLED = 34215; // Feature Flag ON(一時config注入)検証用

fs.writeFileSync(
  TMP_CONFIG_ENABLED,
  `features:\n  growth_director:\n    enabled: true\n`,
  'utf8'
);

let disabledServerProcess;
let enabledServerProcess;

function waitForServerReady(port, checkPath, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  const tryFetch = async () => {
    try {
      const res = await fetch(`http://localhost:${port}${checkPath}`);
      if (res.status) return;
    } catch {
      // まだ起動していない
    }
    if (Date.now() > deadline) throw new Error(`api-server.js(port=${port})の起動待ちがタイムアウトしました`);
    await new Promise((r) => setTimeout(r, 100));
    return tryFetch();
  };
  return tryFetch();
}

const nowIso = '2026-07-16T00:00:00.000Z';

test('setup: api-server.jsをFeature Flag OFF(既定config)・一時DB・専用ポートで起動する', async () => {
  disabledServerProcess = spawn('node', [path.join(ROOT, 'scripts', 'api-server.js')], {
    cwd: ROOT,
    env: { ...process.env, JUKU_BLOG_DB_PATH: TMP_DB, PORT: String(PORT_DISABLED) },
    stdio: 'ignore',
  });
  await waitForServerReady(PORT_DISABLED, '/api/seo/competitors');
});

test('GET /api/seo/page-plans: Feature Flag OFFなら404(feature_disabled)', async () => {
  const res = await fetch(`http://localhost:${PORT_DISABLED}/api/seo/page-plans`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'feature_disabled');
});

test('GET /api/seo/page-plans/:id: Feature Flag OFFなら404(feature_disabled)', async () => {
  const res = await fetch(`http://localhost:${PORT_DISABLED}/api/seo/page-plans/1`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'feature_disabled');
});

test('setup: api-server.jsをFeature Flag ON(一時config)・同一の一時DB・別ポートで起動する', async () => {
  // シードデータ投入(この時点ではDBファイルにJUKU_BLOG_DB_PATHで直接書き込む。
  // 起動中の別サーバー(disabled側)とはポートもプロセスも独立しているため干渉しない)。
  process.env.JUKU_BLOG_DB_PATH = TMP_DB;
  delete require.cache[require.resolve('../scripts/lib/db')];
  delete require.cache[require.resolve('../scripts/lib/seo_db')];
  const seoDb = require('../scripts/lib/seo_db');

  const candidate = seoDb.upsertKeywordCandidate(
    { normalized_keyword: 'APIテスト 塾', target_area: 'x', gap_type: 'weak', priority_score: 70, data_confidence: 75 },
    nowIso
  );
  const primaryTask = seoDb.upsertTask(
    {
      task_type: 'improve_school_page', target_keyword: 'APIテスト 塾', source_candidate_id: candidate.id,
      opportunity_score: 74, recommended_action: 'improve_school_page',
      target_url: 'https://an-english.com/school/api-test/', target_page_type: 'school_page',
      target_page_id: 'api-test', target_page_name: 'APIテスト教室', reason: ['school_page_template'],
    },
    nowIso
  );
  const supportingCandidate = seoDb.upsertKeywordCandidate(
    { normalized_keyword: 'APIテスト 個別指導', target_area: 'x', gap_type: 'shared', priority_score: 70, data_confidence: 60 },
    nowIso
  );
  const supportingTask = seoDb.upsertTask(
    {
      task_type: 'improve_school_page', target_keyword: 'APIテスト 個別指導', source_candidate_id: supportingCandidate.id,
      opportunity_score: 70, recommended_action: 'improve_school_page',
      target_url: 'https://an-english.com/school/api-test/', target_page_type: 'school_page',
      target_page_id: 'api-test', target_page_name: 'APIテスト教室', reason: ['school_page_template'],
    },
    nowIso
  );
  const plan = seoDb.upsertSeoPagePlan(
    {
      groupKey: 'school_page:api-test', targetPageType: 'school_page', targetPageId: 'api-test',
      targetPageName: 'APIテスト教室', targetUrl: 'https://an-english.com/school/api-test/',
      primaryTaskId: primaryTask.id, primaryKeyword: 'APIテスト 塾',
      supportingTaskIds: [supportingTask.id], supportingKeywords: ['APIテスト 個別指導'],
      excludedTasks: [{ taskId: 999, targetKeyword: 'x', reason: 'separate_section_intent' }],
      combinedSearchIntents: ['general_service'],
      selectionBreakdown: { searchIntentPriority: 0, dataConfidence: 75, gscImpressions: null, gapTypePriority: 0, opportunityScore: 74, taskId: primaryTask.id },
      factCheckSummary: { verified: [{ taskId: supportingTask.id, serviceTerm: '個別指導', matchedTerms: ['個別指導'], evidenceSources: ['title'] }], unverified: [], conflicting: [] },
      warnings: [],
      sourceContentHash: null,
      promptVersion: null,
      status: 'proposed',
    },
    nowIso
  );
  global.__apiTestPlanId = plan.id;
  global.__apiTestPrimaryTaskId = primaryTask.id;
  global.__apiTestSupportingTaskId = supportingTask.id;
  require('../scripts/lib/db').closeDb();

  enabledServerProcess = spawn('node', [path.join(ROOT, 'scripts', 'api-server.js')], {
    cwd: ROOT,
    env: { ...process.env, JUKU_BLOG_DB_PATH: TMP_DB, JUKU_BLOG_CONFIG_PATH: TMP_CONFIG_ENABLED, PORT: String(PORT_ENABLED) },
    stdio: 'ignore',
  });
  await waitForServerReady(PORT_ENABLED, '/api/seo/page-plans');
});

test('GET /api/seo/page-plans: Feature Flag ONなら一覧が返る', async () => {
  const res = await fetch(`http://localhost:${PORT_ENABLED}/api/seo/page-plans`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body));
  const plan = body.find((p) => p.targetPageId === 'api-test');
  assert.ok(plan);
  assert.equal(plan.groupKey, 'school_page:api-test');
  assert.equal(plan.primaryKeyword, 'APIテスト 塾');
  assert.deepEqual(plan.supportingTaskIds, [global.__apiTestSupportingTaskId]);
  assert.equal(plan.status, 'proposed');
});

test('GET /api/seo/page-plans?status=proposed: statusフィルタが効く', async () => {
  const res = await fetch(`http://localhost:${PORT_ENABLED}/api/seo/page-plans?status=proposed`);
  const body = await res.json();
  assert.ok(body.every((p) => p.status === 'proposed'));
  const res2 = await fetch(`http://localhost:${PORT_ENABLED}/api/seo/page-plans?status=approved`);
  const body2 = await res2.json();
  assert.equal(body2.length, 0);
});

test('GET /api/seo/page-plans?page_type=&page_id=: ページ指定フィルタが効く', async () => {
  const res = await fetch(`http://localhost:${PORT_ENABLED}/api/seo/page-plans?page_type=school_page&page_id=api-test`);
  const body = await res.json();
  assert.equal(body.length, 1);
  assert.equal(body[0].targetPageId, 'api-test');

  const res2 = await fetch(`http://localhost:${PORT_ENABLED}/api/seo/page-plans?page_type=school_page&page_id=does-not-exist`);
  const body2 = await res2.json();
  assert.equal(body2.length, 0);
});

test('GET /api/seo/page-plans/:id: 詳細が正しいparsed JSONで返る(Primary/Supporting/Excluded/factCheckSummary/reviewHistory含む)', async () => {
  const res = await fetch(`http://localhost:${PORT_ENABLED}/api/seo/page-plans/${global.__apiTestPlanId}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.groupKey, 'school_page:api-test');
  assert.equal(body.primaryTask.target_keyword, 'APIテスト 塾');
  assert.equal(body.supportingTasks.length, 1);
  assert.equal(body.supportingTasks[0].target_keyword, 'APIテスト 個別指導');
  assert.ok(Array.isArray(body.excludedTasks));
  assert.equal(body.factCheckSummary.verified.length, 1);
  assert.deepEqual(body.selectionBreakdown.taskId, global.__apiTestPrimaryTaskId);
  assert.ok(Array.isArray(body.reviewHistory));
  assert.equal(body.reviewHistory.length, 0); // まだ状態遷移していない
});

test('GET /api/seo/page-plans/:id: 存在しないIDは404', async () => {
  const res = await fetch(`http://localhost:${PORT_ENABLED}/api/seo/page-plans/999999`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'not_found');
});

test('GET /api/seo/page-plans/:id: 不正なID(数値でない)は400', async () => {
  const res = await fetch(`http://localhost:${PORT_ENABLED}/api/seo/page-plans/not-a-number`);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_id');
});

test('POST /transition相当のstatus変更APIは実装されていない(安全設計のため意図的に未実装)', async () => {
  const res = await fetch(`http://localhost:${PORT_ENABLED}/api/seo/page-plans/${global.__apiTestPlanId}/transition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedCurrentStatus: 'proposed', nextStatus: 'reviewing', actor: 'admin', source: 'api' }),
  });
  assert.equal(res.status, 404); // Expressの未定義ルートは既定で404
  const plan = await (await fetch(`http://localhost:${PORT_ENABLED}/api/seo/page-plans/${global.__apiTestPlanId}`)).json();
  assert.equal(plan.status, 'proposed'); // statusは変わっていない
});

after(async () => {
  if (disabledServerProcess) {
    disabledServerProcess.kill();
    await new Promise((r) => setTimeout(r, 200));
  }
  if (enabledServerProcess) {
    enabledServerProcess.kill();
    await new Promise((r) => setTimeout(r, 200));
  }
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    // 既に無ければ無視
  }
  try {
    fs.unlinkSync(TMP_CONFIG_ENABLED);
  } catch {
    // 既に無ければ無視
  }
});
