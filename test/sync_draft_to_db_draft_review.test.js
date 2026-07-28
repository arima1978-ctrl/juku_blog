'use strict';

// あま本部校セルフ運用(branches.sync_mode='draft_review'、2026-07-27)の回帰テスト。
// verified到達時、sync_draft_to_db.jsがWordPress下書きへの自動同期を試みることを確認する。
// ローカル開発環境には.envが存在しないため実際のWordPress呼び出しは必ず失敗するが、
// その場合でも記事のDB同期(review_pending)自体は成立し、プロセスが異常終了しないことを
// 確認する(失敗時はダッシュボードの「承認」から再試行できる設計)。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_sync_draft_review_${process.pid}.sqlite`);
process.env.JUKU_BLOG_DB_PATH = TMP_DB;

const { ROOT } = require('../scripts/lib/config');
const { closeDb } = require('../scripts/lib/db');
const branchesDb = require('../scripts/lib/branches_db');

const TMP_DRAFTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'juku_blog_sync_draft_review_drafts_'));
const TMP_ERRORS = path.join(os.tmpdir(), `juku_blog_sync_draft_review_errors_${process.pid}.json`);

after(() => {
  closeDb();
  for (const f of [TMP_DB, `${TMP_DB}-journal`, `${TMP_DB}-wal`, `${TMP_DB}-shm`, TMP_ERRORS]) {
    try {
      fs.unlinkSync(f);
    } catch {
      // 既に無ければ無視
    }
  }
  fs.rmSync(TMP_DRAFTS_DIR, { recursive: true, force: true });
});

test('sync_draft_to_db.js: sync_mode=draft_reviewの校舎はWordPress下書き同期を試み、失敗してもreview_pendingのまま正常終了する', () => {
  const branch = branchesDb.createBranch({ name: 'あま本部(sync_reviewテスト)', slug: '__test_sync_draft_review__' });
  branchesDb.updateBranch(branch.id, { sync_mode: 'draft_review' });

  const draftPath = path.join(TMP_DRAFTS_DIR, '2026-07-27-draft-review-check.md');
  fs.writeFileSync(
    draftPath,
    `---\ntitle: "draft_reviewテスト記事"\nslug: "draft-review-check"\ncategory: "地域情報"\nstatus: "verified"\n---\n本文。\n`,
    'utf8'
  );

  closeDb();

  const env = { ...process.env, JUKU_BRANCH_ID: String(branch.id), JUKU_BRANCH_SLUG: branch.slug, JUKU_BLOG_ERRORS_PATH: TMP_ERRORS };

  const result = spawnSync('node', [path.join(ROOT, 'scripts', 'sync_draft_to_db.js'), draftPath], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
  });
  const combined = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 0, `異常終了してはいけない(stderr: ${result.stderr})`);
  assert.match(combined, /WordPress下書きへの同期に失敗しました|WordPress下書きへ同期しました/);
  assert.match(combined, /完了/);

  // toDbSlug()の実際の変換規則に依存しないよう、branch_id経由で検索する
  const { getDb } = require('../scripts/lib/db');
  const row = getDb().prepare("SELECT * FROM posts WHERE branch_id = ? AND title = 'draft_reviewテスト記事'").get(branch.id);
  assert.ok(row, '記事が保存されているべき');
  assert.ok(
    row.status === 'review_pending' || row.status === 'wp_draft_synced',
    `WP呼び出し成否に関わらずreview_pendingかwp_draft_syncedのどちらかであるべき(実際: ${row.status})`
  );
});

test('sync_draft_to_db.js: process.loadEnvFile()で.envを読み込んでいる(2026-07-28本番障害の回帰。子プロセスとして実行されるため.env読み込みが無いとWP_URL等が常にundefinedになる)', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'sync_draft_to_db.js'), 'utf8');
  assert.match(source, /process\.loadEnvFile\(/, '.envを読み込む処理が無いと、cron経由の子プロセス実行時にWP_URL等が読み込まれない');
});

test('sync_draft_to_db.js: WP_URL等が環境変数にあれば(.env読み込み後を想定)実際にWordPressへ接続を試みる(2026-07-28本番障害の回帰: あま本部初回のWP下書き同期が「.envに設定されていません」で失敗していた)', () => {
  const branch = branchesDb.createBranch({ name: 'あま本部(envロード確認テスト)', slug: '__test_sync_env_load__' });
  branchesDb.updateBranch(branch.id, { sync_mode: 'draft_review' });

  const draftPath = path.join(TMP_DRAFTS_DIR, '2026-07-28-env-load-check.md');
  fs.writeFileSync(
    draftPath,
    `---\ntitle: "envロード確認テスト記事"\nslug: "env-load-check"\ncategory: "地域情報"\nstatus: "verified"\n---\n本文。\n`,
    'utf8'
  );

  closeDb();

  const env = {
    ...process.env,
    JUKU_BRANCH_ID: String(branch.id),
    JUKU_BRANCH_SLUG: branch.slug,
    JUKU_BLOG_ERRORS_PATH: TMP_ERRORS,
    // .env読み込み後に相当する状態を再現する(誰もlistenしていないポート = 確実に接続失敗するが、
    // 「未設定」エラーとは別の実際の接続試行が発生することを確認する)
    WP_URL: 'http://127.0.0.1:1',
    WP_USERNAME: 'dummy',
    WP_APP_PASSWORD: 'dummy',
  };

  const result = spawnSync('node', [path.join(ROOT, 'scripts', 'sync_draft_to_db.js'), draftPath], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
  });
  const combined = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 0);
  assert.ok(!combined.includes('.envに設定されていません'), `WP_URL等が環境変数にあるのに「未設定」エラーになってはいけない: ${combined}`);
  assert.match(combined, /WordPress下書きへの同期に失敗しました/, '実際の接続試行(失敗)が発生しているべき');
});

test('sync_draft_to_db.js: sync_mode=scheduled(既定)の校舎は従来通りreview_pendingのままWordPress呼び出しをしない', () => {
  const branch = branchesDb.createBranch({ name: '小幡(scheduledテスト)', slug: '__test_sync_scheduled__' });
  // sync_modeは既定のまま(scheduled)

  const draftPath = path.join(TMP_DRAFTS_DIR, '2026-07-27-scheduled-check.md');
  fs.writeFileSync(
    draftPath,
    `---\ntitle: "scheduledテスト記事"\nslug: "scheduled-check"\ncategory: "地域情報"\nstatus: "verified"\n---\n本文。\n`,
    'utf8'
  );

  closeDb();

  const env = { ...process.env, JUKU_BRANCH_ID: String(branch.id), JUKU_BRANCH_SLUG: branch.slug, JUKU_BLOG_ERRORS_PATH: TMP_ERRORS };

  const result = spawnSync('node', [path.join(ROOT, 'scripts', 'sync_draft_to_db.js'), draftPath], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
  });
  const combined = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 0, `異常終了してはいけない(stderr: ${result.stderr})`);
  assert.ok(!combined.includes('WordPress下書き'), 'scheduled校舎ではWordPress下書き同期処理が走らないべき');

  const { getDb } = require('../scripts/lib/db');
  const row = getDb().prepare("SELECT * FROM posts WHERE branch_id = ? AND title = 'scheduledテスト記事'").get(branch.id);
  assert.ok(row);
  assert.equal(row.status, 'review_pending');
});
