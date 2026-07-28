'use strict';

// SEO効果測定 週次スナップショット(2026-07-27)のテスト。
// 必ず一時SQLite(JUKU_BLOG_DB_PATH)を使い、実データ(data/posts.sqlite)は一切変更しない。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_metrics_snapshot_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const yaml = require('js-yaml');
const { ROOT } = require('../scripts/lib/config');
const { closeDb, insertPost, setScheduled } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');
const branchesDb = require('../scripts/lib/branches_db');
const { computeGscAttribution, computeSnapshotForBranch, computeKeywordSnapshotsForBranch, weekEndOf, main } = require('../scripts/seo_metrics_snapshot_generate');

function writeDisabledConfig(tmpConfigPath) {
  const config = yaml.load(fs.readFileSync(path.join(ROOT, 'config', 'juku.yaml'), 'utf8'));
  config.features.competitor_keyword_analysis.enabled = false;
  fs.writeFileSync(tmpConfigPath, yaml.dump(config), 'utf8');
  return tmpConfigPath;
}

const TMP_DISABLED_CONFIG = path.join(os.tmpdir(), `juku_blog_metrics_snapshot_disabled_config_${process.pid}.yaml`);
writeDisabledConfig(TMP_DISABLED_CONFIG);

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

const nowIso = '2026-07-27T00:00:00.000Z';
const WEEK_START = '2026-07-13';
const WEEK_END = weekEndOf(WEEK_START);
const BRANCH = { id: 1, name: 'テスト校' };

test('weekEndOf: 月曜から6日後(日曜)を返す', () => {
  assert.equal(weekEndOf('2026-07-13'), '2026-07-19');
});

test('computeSnapshotForBranch: Task status別カウント・ギャップ充足率を正しく集計する', () => {
  seoDb.upsertTask(
    { task_type: 'improve_school_page', target_keyword: 'snap テスト キーワードA', opportunity_score: 70, recommended_action: 'improve_school_page', branch_id: BRANCH.id },
    nowIso
  );
  const taskB = seoDb.upsertTask(
    { task_type: 'improve_school_page', target_keyword: 'snap テスト キーワードB', opportunity_score: 60, recommended_action: 'improve_school_page', branch_id: BRANCH.id },
    nowIso
  );
  seoDb.updateTaskStatus(taskB.id, 'approved', nowIso);
  seoDb.markTaskImplemented(taskB.id, { implementedAt: `${WEEK_END}T12:00:00.000Z` });

  const taskC = seoDb.upsertTask(
    { task_type: 'improve_school_page', target_keyword: 'snap テスト キーワードC', opportunity_score: 50, recommended_action: 'improve_school_page', branch_id: BRANCH.id },
    nowIso
  );
  seoDb.updateTaskStatus(taskC.id, 'approved', nowIso); // 未実施のまま

  const taskD = seoDb.upsertTask(
    { task_type: 'monitor', target_keyword: 'snap テスト キーワードD', opportunity_score: 10, recommended_action: 'monitor', branch_id: BRANCH.id },
    nowIso
  );
  seoDb.updateTaskStatus(taskD.id, 'approved', nowIso); // monitorは分母から除外されるべき

  const gscAttribution = computeGscAttribution({ weekStart: WEEK_START, weekEnd: WEEK_END, allBranches: [BRANCH] });
  const snapshot = computeSnapshotForBranch({ branch: BRANCH, weekStart: WEEK_START, weekEnd: WEEK_END, isBaseline: false, gscAttribution });

  assert.equal(snapshot.taskCountTotal, 4);
  assert.equal(snapshot.taskCountProposed, 1);
  assert.equal(snapshot.taskCountApproved, 3);
  assert.equal(snapshot.taskCountMonitorExclude, 1);
  assert.equal(snapshot.taskCountImplemented, 1);
  // 分母: approvedかつmonitor/exclude以外 = taskB, taskC の2件。分子: 実施済みのtaskBのみ
  assert.equal(snapshot.gapTotalCount, 2);
  assert.equal(snapshot.gapFulfilledCount, 1);
  assert.equal(snapshot.gapFulfillmentRate, 0.5);
});

test('computeSnapshotForBranch: GSC実績を対象週の範囲だけで集計する(範囲外は含めない)', () => {
  seoDb.upsertGscQueryRow(
    { site_property: 'sc-domain:an-english.com', date: WEEK_START, query: 'snap gsc 週内', page: 'https://an-english.com/school/obata/', impressions: 100, clicks: 10, ctr: 0.1, position: 5 },
    nowIso
  );
  seoDb.upsertGscQueryRow(
    { site_property: 'sc-domain:an-english.com', date: '2026-06-01', query: 'snap gsc 週外', page: 'https://an-english.com/school/obata/', impressions: 999, clicks: 999, ctr: 0.5, position: 1 },
    nowIso
  );

  const gscAttribution = computeGscAttribution({ weekStart: WEEK_START, weekEnd: WEEK_END, allBranches: [BRANCH] });
  const snapshot = computeSnapshotForBranch({ branch: BRANCH, weekStart: WEEK_START, weekEnd: WEEK_END, isBaseline: false, gscAttribution });
  assert.equal(snapshot.impressionsTotal, 100);
  assert.equal(snapshot.clicksTotal, 10);
});

test('computeGscAttribution/computeSnapshotForBranch: 校舎別ブログ・その他へ正しく分解される(2026-07-29、残差を校舎へ割り当てない)', () => {
  const branchB = branchesDb.createBranch({ name: '別校舎テスト', slug: '__test_snapshot_branch_b__' });
  const postA = insertPost({ created_at: nowIso, slug: 'snap-attr-a', branch_id: BRANCH.id, title: 'A', category: 'c', body_md: 'x', body_html: 'x' });
  setScheduled(postA, { wpPostId: 50001, wpLink: 'https://an-english.com/?p=50001', scheduledAt: nowIso });
  const postB = insertPost({ created_at: nowIso, slug: 'snap-attr-b', branch_id: branchB.id, title: 'B', category: 'c', body_md: 'x', body_html: 'x' });
  setScheduled(postB, { wpPostId: 50002, wpLink: 'https://an-english.com/?p=50002', scheduledAt: nowIso });

  seoDb.upsertGscQueryRows(
    [
      { site_property: 'sc-domain:an-english.com', date: WEEK_START, query: 'snap-a', page: 'https://an-english.com/2026/07/50001/', impressions: 200, clicks: 20 },
      { site_property: 'sc-domain:an-english.com', date: WEEK_START, query: 'snap-b', page: 'https://an-english.com/2026/07/50002/', impressions: 150, clicks: 15 },
      { site_property: 'sc-domain:an-english.com', date: WEEK_START, query: 'snap-other', page: 'https://an-english.com/recruit/', impressions: 30, clicks: 1 },
    ],
    nowIso
  );

  const gscAttribution = computeGscAttribution({ weekStart: WEEK_START, weekEnd: WEEK_END, allBranches: [BRANCH, branchB] });
  const snapshotA = computeSnapshotForBranch({ branch: BRANCH, weekStart: WEEK_START, weekEnd: WEEK_END, isBaseline: false, gscAttribution });
  const snapshotB = computeSnapshotForBranch({ branch: branchB, weekStart: WEEK_START, weekEnd: WEEK_END, isBaseline: false, gscAttribution });

  assert.equal(snapshotA.impressionsBlog, 200);
  assert.equal(snapshotB.impressionsBlog, 150);
  // 「その他」はどちらの校舎の値を見ても同じ(校舎へ割り当てない共有値)
  assert.equal(snapshotA.impressionsOther, 30);
  assert.equal(snapshotB.impressionsOther, 30);
});

test('computeKeywordSnapshotsForBranch: implemented_atが週末以前なら実施済みフラグが立つ', () => {
  const rows = computeKeywordSnapshotsForBranch({ branch: BRANCH, weekStart: WEEK_START, weekEnd: WEEK_END, isBaseline: false });
  const implementedRow = rows.find((r) => r.normalizedKeyword === 'snap テスト キーワードB');
  const notImplementedRow = rows.find((r) => r.normalizedKeyword === 'snap テスト キーワードC');
  assert.equal(implementedRow.isImplementedAsOfWeek, true);
  assert.equal(notImplementedRow.isImplementedAsOfWeek, false);
});

function yesterdayAsWeekStart() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const y = yesterday.getFullYear();
  const m = String(yesterday.getMonth() + 1).padStart(2, '0');
  const d = String(yesterday.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`; // 昨日を「対象週の月曜」として渡す(週末はさらに6日後の未来)
}

test('CLI: 週末から3日経っていない対象週はbaseline無しだと保存を拒否する(2026-07-29、実インシデント回帰テスト)', () => {
  const { spawnSync } = require('node:child_process');
  const guardBranch = branchesDb.createBranch({ name: 'ガードテスト校A', slug: '__test_snapshot_guard_a__' });
  const recentWeek = yesterdayAsWeekStart();

  const result = spawnSync(
    'node',
    [path.join(ROOT, 'scripts', 'seo_metrics_snapshot_generate.js'), `--week=${recentWeek}`, `--branch-id=${guardBranch.id}`, '--save'],
    { encoding: 'utf8', env: process.env }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /まだ完全ではない可能性/);
  assert.equal(seoDb.listSeoMetricsSnapshots(guardBranch.id).length, 0);
});

test('CLI: --baselineを指定すれば直近週でも防御チェックを回避して保存できる', () => {
  const { spawnSync } = require('node:child_process');
  const guardBranch = branchesDb.createBranch({ name: 'ガードテスト校B', slug: '__test_snapshot_guard_b__' });
  const recentWeek = yesterdayAsWeekStart();

  const result = spawnSync(
    'node',
    [path.join(ROOT, 'scripts', 'seo_metrics_snapshot_generate.js'), `--week=${recentWeek}`, `--branch-id=${guardBranch.id}`, '--baseline', '--save'],
    { encoding: 'utf8', env: process.env }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.ok(seoDb.listSeoMetricsSnapshots(guardBranch.id).find((s) => s.week_start === recentWeek));
});

test('CLI: --dry-run(既定)ではDBへ保存しない', () => {
  execFileSync('node', [path.join(ROOT, 'scripts', 'seo_metrics_snapshot_generate.js'), `--week=${WEEK_START}`, `--branch-id=${BRANCH.id}`, '--dry-run'], {
    env: process.env,
  });
  assert.equal(seoDb.listSeoMetricsSnapshots(BRANCH.id).length, 0);
});

test('CLI: --saveで保存し、再実行するとUPSERT(重複行が増えない)される', () => {
  execFileSync('node', [path.join(ROOT, 'scripts', 'seo_metrics_snapshot_generate.js'), `--week=${WEEK_START}`, `--branch-id=${BRANCH.id}`, '--save'], {
    env: process.env,
  });
  execFileSync('node', [path.join(ROOT, 'scripts', 'seo_metrics_snapshot_generate.js'), `--week=${WEEK_START}`, `--branch-id=${BRANCH.id}`, '--save'], {
    env: process.env,
  });
  const snapshots = seoDb.listSeoMetricsSnapshots(BRANCH.id);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].week_start, WEEK_START);

  const kwSnapshots = seoDb.listSeoMetricsKeywordSnapshots(BRANCH.id);
  const uniqueKeywords = new Set(kwSnapshots.map((r) => r.normalized_keyword));
  assert.equal(kwSnapshots.length, uniqueKeywords.size); // 重複行が無い
});

test('CLI: --branch-id省略時はis_activeに関わらず全校舎が対象になる(2026-07-28本番障害の回帰: is_active=falseのあま本部校が除外されていた)', () => {
  const inactiveBranch = branchesDb.createBranch({ name: '非アクティブ校舎テスト', slug: '__test_inactive_branch__' });
  // is_active=0のまま(createBranchの既定)。ダッシュボードの表示トグルであり分析対象とは無関係。

  execFileSync('node', [path.join(ROOT, 'scripts', 'seo_metrics_snapshot_generate.js'), `--week=${WEEK_START}`, '--save', '--format=json'], {
    env: process.env,
  });

  const snapshots = seoDb.listSeoMetricsSnapshots(inactiveBranch.id);
  assert.equal(snapshots.length, 1, 'is_active=falseでも--branch-id省略時は分析対象に含まれるべき');
});

test('CLI: competitor_keyword_analysis.enabled=false のときは無処理で終了する(DB変更なし)', () => {
  const output = execFileSync('node', [path.join(ROOT, 'scripts', 'seo_metrics_snapshot_generate.js'), `--week=${WEEK_START}`, '--dry-run'], {
    env: { ...process.env, JUKU_BLOG_CONFIG_PATH: TMP_DISABLED_CONFIG },
  }).toString();
  assert.match(output, /無処理で終了/);
});

test('main: --week未指定ならexitCode=1で使い方を表示する', () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  process.argv = ['node', 'seo_metrics_snapshot_generate.js'];
  try {
    main();
    assert.equal(process.exitCode, 1);
  } finally {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
  }
});
