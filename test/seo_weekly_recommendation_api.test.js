'use strict';

// Sprint 4.0: GET /api/seo/weekly-recommendation・POST .../:batchDate/approveの結合テスト。
// api-server.jsを実際に子プロセスで起動し、一時DB・専用ポート・一時config
// (growth_director.enabled=true、共有のconfig/juku.yamlは書き換えない)を使う。
// requireLocalhostの非ローカルホスト拒否は、実HTTP経由では決定的に再現できないため
// (テスト自身もlocalhost経由で接続するため)、抽出済みモジュールを直接単体テストする。

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');
const { ROOT } = require('../scripts/lib/config');

// 安全カナリア: このファイルはJUKU_BLOG_DB_PATH切り替え+require.cache操作を多用するため、
// 万一どこかで一時DBへの切り替えが効かず実DB(data/posts.sqlite)へ書き込んでしまった場合に
// 検知できるよう、db.js/seo_db.jsのキャッシュ機構を一切経由しない生のDatabaseSyncで
// 実DBのseo_tasks/seo_keyword_candidates件数を直接スナップショットし、after()で不変を検証する。
const REAL_DB_PATH = path.join(ROOT, 'data', 'posts.sqlite');
function countRealDbRows() {
  const raw = new DatabaseSync(REAL_DB_PATH, { readOnly: true });
  try {
    return {
      seoTasks: raw.prepare('SELECT COUNT(*) c FROM seo_tasks').get().c,
      seoKeywordCandidates: raw.prepare('SELECT COUNT(*) c FROM seo_keyword_candidates').get().c,
      seoWeeklyRecommendations: raw.prepare('SELECT COUNT(*) c FROM seo_weekly_recommendations').get().c,
    };
  } finally {
    raw.close();
  }
}
const realDbSnapshotBefore = countRealDbRows();
const { mondayOfWeek } = require('../scripts/seo_weekly_director');
const { promptFilePath } = require('../scripts/lib/seo/weekly_draft_dispatcher');
const { requireLocalhost, isLocalhostIp } = require('../scripts/lib/require_localhost');

const TMP_CONFIG_ENABLED = path.join(os.tmpdir(), `juku_blog_weekly_rec_api_config_enabled_${process.pid}.yaml`);
fs.writeFileSync(
  TMP_CONFIG_ENABLED,
  yaml.dump((() => {
    const config = yaml.load(fs.readFileSync(path.join(ROOT, 'config', 'juku.yaml'), 'utf8'));
    config.features.growth_director.enabled = true;
    return config;
  })()),
  'utf8'
);

const TMP_DB_FALLBACK = path.join(os.tmpdir(), `juku_blog_weekly_rec_api_fallback_${process.pid}.sqlite`);
const TMP_DB_CURRENT = path.join(os.tmpdir(), `juku_blog_weekly_rec_api_current_${process.pid}.sqlite`);
const PORT_FALLBACK = 34216; // テスト専用の未使用ポート
const PORT_CURRENT = 34217; // テスト専用の未使用ポート

const THIS_WEEK_MONDAY = mondayOfWeek(new Date());
const OLD_BATCH_DATE = '2020-01-06'; // 明らかに「今週」ではない過去の月曜日

let fallbackServerProcess;
let currentServerProcess;
let currentWeekPromptRelPath; // after()での後始末用に実ファイルパスを記録する

function waitForServerReady(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  const tryFetch = async () => {
    try {
      const res = await fetch(`http://localhost:${port}/api/seo/competitors`);
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

const nowIso = '2026-07-15T00:00:00.000Z';

// db.js/seo_db.jsはgetDb()内でモジュール読み込み時点のJUKU_BLOG_DB_PATHを元に接続を
// キャッシュするため、同一プロセス内で2つ目の一時DBへ切り替える際はrequire.cacheを
// 明示的に破棄してから再requireしないと、古い接続(=1つ目のDBファイル)への書き込みが
// 継続してしまう(Sprint 3.9のテストで発見した既知の落とし穴と同じ)。
function freshSeoDb(dbPath) {
  process.env.JUKU_BLOG_DB_PATH = dbPath;
  delete require.cache[require.resolve('../scripts/lib/db')];
  delete require.cache[require.resolve('../scripts/lib/seo_db')];
  return require('../scripts/lib/seo_db');
}

after(() => {
  if (fallbackServerProcess) fallbackServerProcess.kill();
  if (currentServerProcess) currentServerProcess.kill();
  [TMP_CONFIG_ENABLED, TMP_DB_FALLBACK, TMP_DB_CURRENT].forEach((f) => {
    try {
      fs.unlinkSync(f);
    } catch {
      // 既に無ければ無視
    }
  });
  if (currentWeekPromptRelPath) {
    try {
      fs.rmSync(path.join(ROOT, path.dirname(currentWeekPromptRelPath)), { recursive: true, force: true });
    } catch {
      // 既に無ければ無視
    }
  }
  // 安全カナリア: 後始末が終わった時点で実DBの件数がテスト開始前と一致するか検証する。
  // 万一どこかで一時DB切り替えが効かず実DBを汚染していた場合、ここで確実に検知する。
  const realDbSnapshotAfter = countRealDbRows();
  assert.deepEqual(
    realDbSnapshotAfter,
    realDbSnapshotBefore,
    `安全カナリア失敗: 実DB(data/posts.sqlite)の件数がテスト前後で変化しています(before=${JSON.stringify(realDbSnapshotBefore)}, after=${JSON.stringify(realDbSnapshotAfter)})`
  );
});

// --- requireLocalhostミドルウェアの単体テスト(非ローカルホスト拒否を決定的に検証) ---

test('requireLocalhost: 127.0.0.1/::1/::ffff:127.0.0.1はローカルホスト扱いでnext()が呼ばれる', () => {
  ['127.0.0.1', '::1', '::ffff:127.0.0.1'].forEach((ip) => {
    let nextCalled = false;
    const req = { ip, socket: {} };
    const res = { status: () => { throw new Error('status()が呼ばれるべきではない'); } };
    requireLocalhost(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true, `${ip}はローカルホストとして許可されるべき`);
  });
});

test('requireLocalhost: 非ローカルホストIPは403 forbidden_non_localhostを返しnext()を呼ばない', () => {
  let nextCalled = false;
  let statusCode = null;
  let jsonBody = null;
  const req = { ip: '203.0.113.5', socket: {} };
  const res = {
    status(code) {
      statusCode = code;
      return { json: (body) => { jsonBody = body; } };
    },
  };
  requireLocalhost(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(statusCode, 403);
  assert.deepEqual(jsonBody, { error: 'forbidden_non_localhost' });
});

test('isLocalhostIp: ヘルパー関数単体の真偽判定', () => {
  assert.equal(isLocalhostIp('127.0.0.1'), true);
  assert.equal(isLocalhostIp('::1'), true);
  assert.equal(isLocalhostIp('8.8.8.8'), false);
  assert.equal(isLocalhostIp(undefined), false);
});

// --- フォールバック検証用サーバー(今週分が存在しないケース) ---

test('setup: フォールバック検証用に、今週分の無いDBでapi-server.jsを起動する', async () => {
  const seoDb = freshSeoDb(TMP_DB_FALLBACK);
  // APIの?branch_id省略時は現在アクティブな校舎にフォールバックするため、
  // シード時点でconfig由来の自動作成校舎(アクティブ)のIDを明示的に紐づけておく。
  const activeBranchId = require('../scripts/lib/branches_db').getActiveBranch().id;
  const candidate = seoDb.upsertKeywordCandidate(
    { normalized_keyword: '週次API フォールバックテスト', target_area: 'x', gap_type: 'weak', priority_score: 70, data_confidence: 75 },
    nowIso
  );
  const task = seoDb.upsertTask(
    {
      task_type: 'create_article',
      target_keyword: '週次API フォールバックテスト',
      source_candidate_id: candidate.id,
      opportunity_score: 60,
      recommended_action: 'create_article',
      estimated_effort_minutes: 30,
      roi_priority_score: 40,
      expected_impact_cv: 0.2,
    },
    nowIso
  );
  seoDb.upsertWeeklyRecommendation(
    {
      batchDate: OLD_BATCH_DATE,
      branchId: activeBranchId,
      status: 'proposed',
      taskIds: [task.id],
      items: [
        {
          taskId: task.id,
          taskType: 'create_article',
          targetKeyword: '週次API フォールバックテスト',
          roiPriorityScore: 40,
          opportunityScore: 60,
          difficultyScore: null,
          expectedImpactCv: 0.2,
          expectedImpactClicks: null,
          estimatedEffortMinutes: 30,
          draftStatus: 'prompt_generated',
          draftPromptPath: null,
          pagePlanId: null,
          pagePlanStatus: null,
        },
      ],
      totalExpectedCv: 0.2,
      totalEffortMinutes: 30,
      taskTypeBreakdown: { create_article: 1 },
      curationTier: 'strict',
      curationParams: {},
    },
    nowIso
  );
  require('../scripts/lib/db').closeDb();

  fallbackServerProcess = spawn('node', [path.join(ROOT, 'scripts', 'api-server.js')], {
    cwd: ROOT,
    env: { ...process.env, JUKU_BLOG_DB_PATH: TMP_DB_FALLBACK, JUKU_BLOG_CONFIG_PATH: TMP_CONFIG_ENABLED, PORT: String(PORT_FALLBACK) },
    stdio: 'ignore',
  });
  await waitForServerReady(PORT_FALLBACK);
});

test('GET /api/seo/weekly-recommendation: 今週分が無ければ直近レコードにフォールバックし、isLatest:falseになる', async () => {
  const res = await fetch(`http://localhost:${PORT_FALLBACK}/api/seo/weekly-recommendation`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.batchDate, OLD_BATCH_DATE);
  assert.equal(body.isLatest, false);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].draftPrompt, null);
  assert.ok(body.items[0].task, 'seoDb.getTaskById()でジョインされたtask詳細が含まれるべき');
  assert.equal(body.items[0].task.target_keyword, '週次API フォールバックテスト');
});

// --- 正常系検証用サーバー(今週分が存在するケース) ---

test('setup: 正常系検証用に、今週分ありのDBでapi-server.jsを起動する', async () => {
  const seoDb = freshSeoDb(TMP_DB_CURRENT);
  // APIの?branch_id省略時は現在アクティブな校舎にフォールバックするため、
  // シード時点でconfig由来の自動作成校舎(アクティブ)のIDを明示的に紐づけておく。
  const activeBranchId = require('../scripts/lib/branches_db').getActiveBranch().id;
  const candidate = seoDb.upsertKeywordCandidate(
    { normalized_keyword: '週次API 正常系テスト', target_area: 'x', gap_type: 'weak', priority_score: 70, data_confidence: 75 },
    nowIso
  );
  const task = seoDb.upsertTask(
    {
      task_type: 'create_article',
      target_keyword: '週次API 正常系テスト',
      source_candidate_id: candidate.id,
      opportunity_score: 70,
      recommended_action: 'create_article',
      estimated_effort_minutes: 30,
      roi_priority_score: 80,
      expected_impact_cv: 0.5,
    },
    nowIso
  );

  // data/seo_drafts/直下のフラットな命名(weekly_<batchDate>_task_<id>.prompt.json)は、
  // 新規一時DBの最初のTaskが常にid=1になることと、THIS_WEEK_MONDAYが実際の「今週」の
  // 月曜日であることから、test/seo_weekly_director_cli.test.jsのCLI統合テスト
  // (同じくbatch_date='今週'・task_id=1〜3で実ファイルを書く)と実ファイル名が衝突しうる
  // (両テストが別プロセスとして並行実行された場合、互いのafter()による削除と競合する)。
  // PID固有のサブディレクトリに隔離することで、他テストとの実ファイル衝突を避ける。
  const relDir = path.join('data', 'seo_drafts', `test-weekly-rec-api-${process.pid}`);
  fs.mkdirSync(path.join(ROOT, relDir), { recursive: true });
  currentWeekPromptRelPath = promptFilePath(relDir, THIS_WEEK_MONDAY, task.id);
  fs.writeFileSync(
    path.join(ROOT, currentWeekPromptRelPath),
    JSON.stringify({
      task_id: task.id,
      task_type: 'create_article',
      target_keyword: '週次API 正常系テスト',
      prompt_version: 'v3',
      prompt_mode: 'full_context',
      gap_type: 'weak',
      prompt: 'テスト用Prompt本文です。',
    }),
    'utf8'
  );

  // Sprint 4.1: draftPromptPathの.result.jsonが既に存在する(=Claude Code subagent等が
  // 既に完成原稿を生成済み)場合、draftResultとしてマージされることを検証するための
  // 2件目のTask。draftStatusはpublished_draftとし、WordPress投稿済みでも原稿プレビュー
  // が引き続き閲覧可能であることも同時に確認する。
  const taskWithResult = seoDb.upsertTask(
    {
      task_type: 'create_article',
      target_keyword: '週次API 原稿プレビューテスト',
      source_candidate_id: candidate.id,
      opportunity_score: 65,
      recommended_action: 'create_article',
      estimated_effort_minutes: 30,
      roi_priority_score: 60,
      expected_impact_cv: 0.4,
    },
    nowIso
  );
  const taskWithResultPromptRelPath = promptFilePath(relDir, THIS_WEEK_MONDAY, taskWithResult.id);
  const taskWithResultResultRelPath = taskWithResultPromptRelPath.replace(/\.prompt\.json$/, '.result.json');
  fs.writeFileSync(
    path.join(ROOT, taskWithResultResultRelPath),
    JSON.stringify({
      can_generate: true,
      title: '守山区の個別指導塾なら',
      body_html: '<p>守山区で個別指導をお探しの方へ、実際の記事本文です。</p>',
      meta_description: '守山区の個別指導塾の紹介です。',
      warnings: [],
    }),
    'utf8'
  );
  global.__weeklyRecApiTaskWithResultId = taskWithResult.id;

  seoDb.upsertWeeklyRecommendation(
    {
      batchDate: THIS_WEEK_MONDAY,
      branchId: activeBranchId,
      status: 'proposed',
      taskIds: [task.id, taskWithResult.id],
      items: [
        {
          taskId: task.id,
          taskType: 'create_article',
          targetKeyword: '週次API 正常系テスト',
          roiPriorityScore: 80,
          opportunityScore: 70,
          difficultyScore: 20,
          expectedImpactCv: 0.5,
          expectedImpactClicks: 12.3,
          estimatedEffortMinutes: 30,
          draftStatus: 'prompt_generated',
          draftPromptPath: currentWeekPromptRelPath,
          pagePlanId: null,
          pagePlanStatus: null,
        },
        {
          taskId: taskWithResult.id,
          taskType: 'create_article',
          targetKeyword: '週次API 原稿プレビューテスト',
          roiPriorityScore: 60,
          opportunityScore: 65,
          difficultyScore: 15,
          expectedImpactCv: 0.4,
          expectedImpactClicks: 8,
          estimatedEffortMinutes: 30,
          draftStatus: 'published_draft',
          draftPromptPath: taskWithResultPromptRelPath,
          pagePlanId: null,
          pagePlanStatus: null,
          wpPostId: 99001,
        },
      ],
      totalExpectedCv: 0.9,
      totalEffortMinutes: 60,
      taskTypeBreakdown: { create_article: 2 },
      curationTier: 'strict',
      curationParams: {},
    },
    nowIso
  );
  global.__weeklyRecApiTaskId = task.id;
  require('../scripts/lib/db').closeDb();

  currentServerProcess = spawn('node', [path.join(ROOT, 'scripts', 'api-server.js')], {
    cwd: ROOT,
    env: { ...process.env, JUKU_BLOG_DB_PATH: TMP_DB_CURRENT, JUKU_BLOG_CONFIG_PATH: TMP_CONFIG_ENABLED, PORT: String(PORT_CURRENT) },
    stdio: 'ignore',
  });
  await waitForServerReady(PORT_CURRENT);
});

test('GET /api/seo/weekly-recommendation: 今週分があれば直接返り、isLatest:true・Promptファイルが自動マージされる', async () => {
  // Windows環境では、直前にfs.writeFileSyncで書いたファイルをAV等が一時的にロックし、
  // 別プロセス(spawnしたapi-server.js)からの直後のreadFileSyncがまれに失敗することが
  // あるため(readDraftPromptはcatchしてnullを返す設計)、短い再試行を許容する。
  // DB由来のフィールド(task結合等)は同じ理由で揺らがないため再試行の対象にしない。
  let body;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fetch(`http://localhost:${PORT_CURRENT}/api/seo/weekly-recommendation`);
    assert.equal(res.status, 200);
    body = await res.json();
    if (body.items[0] && body.items[0].draftPrompt) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  assert.equal(body.batchDate, THIS_WEEK_MONDAY);
  assert.equal(body.isLatest, true);
  assert.equal(body.status, 'proposed');
  assert.equal(body.curationTier, 'strict');
  assert.equal(body.totalExpectedCv, 0.9);
  assert.equal(body.totalEffortMinutes, 60);

  const item = body.items[0];
  assert.equal(item.taskId, global.__weeklyRecApiTaskId);
  assert.equal(item.roiPriorityScore, 80);
  assert.ok(item.task, 'task詳細がジョインされているべき');
  assert.equal(item.task.target_keyword, '週次API 正常系テスト');
  assert.ok(item.draftPrompt, 'Promptファイルの中身がマージされているべき(複数回試行後)');
  assert.equal(item.draftPrompt.text, 'テスト用Prompt本文です。');
  assert.equal(item.draftPrompt.promptVersion, 'v3');
  assert.equal(item.draftPrompt.gapType, 'weak');
});

test('GET /api/seo/weekly-recommendation: .result.jsonが存在しない場合はdraftResult:nullになる', async () => {
  const res = await fetch(`http://localhost:${PORT_CURRENT}/api/seo/weekly-recommendation`);
  assert.equal(res.status, 200);
  const body = await res.json();
  const item = body.items.find((i) => i.taskId === global.__weeklyRecApiTaskId);
  assert.ok(item, '対象タスクが見つかるべき');
  assert.equal(item.draftResult, null);
});

test('GET /api/seo/weekly-recommendation: .result.jsonが存在する場合はdraftResultが正しくマージされ、published_draftでも閲覧できる', async () => {
  let item;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fetch(`http://localhost:${PORT_CURRENT}/api/seo/weekly-recommendation`);
    assert.equal(res.status, 200);
    const body = await res.json();
    item = body.items.find((i) => i.taskId === global.__weeklyRecApiTaskWithResultId);
    if (item && item.draftResult) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  assert.ok(item, '対象タスクが見つかるべき');
  assert.equal(item.draftStatus, 'published_draft', 'WordPress投稿済みのタスクであることの前提確認');
  assert.ok(item.draftResult, '.result.jsonの中身がdraftResultとしてマージされているべき');
  assert.equal(item.draftResult.title, '守山区の個別指導塾なら');
  assert.equal(item.draftResult.bodyHtml, '<p>守山区で個別指導をお探しの方へ、実際の記事本文です。</p>');
  assert.equal(item.draftResult.metaDescription, '守山区の個別指導塾の紹介です。');
});

test('GET /api/seo/weekly-recommendation?batch_date=...: 明示指定でも同じレコードを取得できる', async () => {
  const res = await fetch(`http://localhost:${PORT_CURRENT}/api/seo/weekly-recommendation?batch_date=${THIS_WEEK_MONDAY}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.batchDate, THIS_WEEK_MONDAY);
});

test('POST /api/seo/weekly-recommendation/:batchDate/approve: proposed→approvedへ安全に遷移する', async () => {
  const res = await fetch(`http://localhost:${PORT_CURRENT}/api/seo/weekly-recommendation/${THIS_WEEK_MONDAY}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedCurrentStatus: 'proposed' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, 'approved');

  const check = await fetch(`http://localhost:${PORT_CURRENT}/api/seo/weekly-recommendation?batch_date=${THIS_WEEK_MONDAY}`);
  assert.equal((await check.json()).status, 'approved');
});

test('POST /api/seo/weekly-recommendation/:batchDate/approve: 既にapproved済みでexpectedCurrentStatus=proposedを送ると409', async () => {
  const res = await fetch(`http://localhost:${PORT_CURRENT}/api/seo/weekly-recommendation/${THIS_WEEK_MONDAY}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedCurrentStatus: 'proposed' }),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, 'status_conflict');
  assert.equal(body.actualStatus, 'approved');
});

test('POST /api/seo/weekly-recommendation/:batchDate/approve: expectedCurrentStatus省略は400', async () => {
  const res = await fetch(`http://localhost:${PORT_CURRENT}/api/seo/weekly-recommendation/${THIS_WEEK_MONDAY}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'expected_current_status_required');
});

test('POST /api/seo/weekly-recommendation/:batchDate/approve: 存在しないbatch_dateは404', async () => {
  const res = await fetch(`http://localhost:${PORT_CURRENT}/api/seo/weekly-recommendation/1999-01-04/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedCurrentStatus: 'proposed' }),
  });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'not_found');
});
