'use strict';

// あま本部等、新規校舎の初期データ生成をダッシュボードのボタン操作だけで完結できるように
// 追加した実行系API(POST /api/seo/competitors, /api/seo/crawl, /api/seo/generate-tasks,
// /api/seo/weekly-recommendation/generate)の結合テスト。
// api-server.jsを子プロセスで起動し、一時DB・専用ポートを使う(本番data/posts.sqliteや
// PORT 3013には触れない)。実際のクロール・ページ本文取得は候補/タスクが0件の場合は
// 一切走らない設計を利用し、外部ネットワークへは接続しないケースのみを検証する
// (実際のクロール・Page Plan生成ロジック自体は各resolve*関数の既存テストで検証済み)。

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');
const { ROOT } = require('../scripts/lib/config');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_seo_action_api_test_${process.pid}.sqlite`);
const TMP_CONFIG = path.join(os.tmpdir(), `juku_blog_seo_action_api_config_${process.pid}.yaml`);
const PORT = 34219; // テスト専用の未使用ポート

// resolveTaskGenerate/resolveCompetitorCrawlはconfig.seo.growth_director/competitor_analysis
// (user_agent・重みづけ等)を直接参照するため、featuresだけの最小configでは
// TypeErrorになる。実configをベースにfeaturesのみ有効化する(他テストと同じ手法)。
fs.writeFileSync(
  TMP_CONFIG,
  yaml.dump((() => {
    const config = yaml.load(fs.readFileSync(path.join(ROOT, 'config', 'juku.yaml'), 'utf8'));
    config.features.growth_director.enabled = true;
    config.features.competitor_keyword_analysis.enabled = true;
    config.features.competitor_keyword_analysis.crawl_enabled = true;
    return config;
  })()),
  'utf8'
);

let serverProcess;

function waitForServerReady(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  const tryFetch = async () => {
    try {
      const res = await fetch(`http://localhost:${PORT}/api/branches`);
      if (res.status) return;
    } catch {
      // まだ起動していない
    }
    if (Date.now() > deadline) throw new Error('api-server.jsの起動待ちがタイムアウトしました');
    await new Promise((r) => setTimeout(r, 100));
    return tryFetch();
  };
  return tryFetch();
}

after(() => {
  if (serverProcess) serverProcess.kill();
  [TMP_DB, TMP_CONFIG].forEach((f) => {
    try {
      fs.unlinkSync(f);
    } catch {
      // 既に無ければ無視
    }
  });
});

test('setup: api-server.jsを一時DB・専用ポート・growth_director/competitor_keyword_analysis有効configで起動する', async () => {
  serverProcess = spawn('node', [path.join(ROOT, 'scripts', 'api-server.js')], {
    cwd: ROOT,
    env: { ...process.env, JUKU_BLOG_DB_PATH: TMP_DB, JUKU_BLOG_CONFIG_PATH: TMP_CONFIG, PORT: String(PORT), ALLOW_REMOTE_APPROVE: 'true' },
    stdio: 'ignore',
  });
  await waitForServerReady();
});

test('POST /api/seo/competitors: name/domain必須項目が無ければ400', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/seo/competitors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'name_and_domain_required');
});

test('POST /api/seo/competitors: 校舎に競合塾を新規登録できる(現在アクティブな校舎に紐づく)', async () => {
  const activeBranches = await (await fetch(`http://localhost:${PORT}/api/branches`)).json();
  const activeBranchId = activeBranches.find((b) => b.is_active).id;

  const res = await fetch(`http://localhost:${PORT}/api/seo/competitors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'あま市の学習塾テスト',
      domain: 'https://ama-juku-test.example.com/',
      target_areas: 'あま市, 甚目寺',
    }),
  });
  assert.equal(res.status, 200);
  const competitor = await res.json();
  assert.equal(competitor.name, 'あま市の学習塾テスト');
  assert.equal(competitor.domain, 'ama-juku-test.example.com');
  assert.equal(competitor.branch_id, activeBranchId);
  assert.equal(competitor.crawl_enabled, 1);

  const list = await (await fetch(`http://localhost:${PORT}/api/seo/competitors?branch_id=${activeBranchId}`)).json();
  assert.ok(list.some((c) => c.id === competitor.id));
});

test('POST /api/seo/competitors: 同一ドメイン+校舎の再登録は新規重複でなく更新になる', async () => {
  const first = await (
    await fetch(`http://localhost:${PORT}/api/seo/competitors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '重複テスト塾', domain: 'https://dup-test.example.com/' }),
    })
  ).json();
  const second = await (
    await fetch(`http://localhost:${PORT}/api/seo/competitors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '重複テスト塾(更新後)', domain: 'https://dup-test.example.com/' }),
    })
  ).json();
  assert.equal(first.id, second.id);
  assert.equal(second.name, '重複テスト塾(更新後)');
});

test('POST /api/seo/crawl: 対象の競合が(そのbranch_idに)無ければクロール・解析・Gap計算とも即完了する(ネットワーク未接続)', async () => {
  // 別のダミー校舎(競合未登録)を作成し、そのbranch_idを明示して呼び出す。
  const branch = await (
    await fetch(`http://localhost:${PORT}/api/branches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'クロール未登録校舎テスト' }),
    })
  ).json();

  const res = await fetch(`http://localhost:${PORT}/api/seo/crawl?branch_id=${branch.id}`, { method: 'POST' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.crawl.reason, 'no_targets');
  assert.deepEqual(body.crawl.summary, []);
  // クロール対象が無い(競合が0件)ため、後続のページ解析・Gap計算も実行されずスキップされる。
  assert.equal(body.analyze.reason, 'skipped');
  assert.equal(body.gap.reason, 'skipped');
});

test('POST /api/seo/generate-tasks: 対象のキーワード候補が無ければno_candidatesとして安全に完了する', async () => {
  const branch = await (
    await fetch(`http://localhost:${PORT}/api/branches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'タスク生成未登録校舎テスト' }),
    })
  ).json();

  const res = await fetch(`http://localhost:${PORT}/api/seo/generate-tasks?branch_id=${branch.id}`, { method: 'POST' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.tasks.tasks_created, 0);
  assert.equal(body.pagePlans.generated, 0);
});

test('POST /api/seo/weekly-recommendation/generate: 対象のTaskが無くても空の提案として安全に完了する', async () => {
  const branch = await (
    await fetch(`http://localhost:${PORT}/api/branches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '週次提案未登録校舎テスト' }),
    })
  ).json();

  const res = await fetch(`http://localhost:${PORT}/api/seo/weekly-recommendation/generate?branch_id=${branch.id}`, { method: 'POST' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.itemCount, 0);
});
