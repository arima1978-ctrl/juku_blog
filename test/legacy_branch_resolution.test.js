'use strict';

// 2026-07-20判明した実インシデントの回帰テスト: legacy(校舎コンテキスト無し)実行時の
// 校舎解決に getActiveBranch()(ダッシュボードの校舎切り替えトグル、ユーザーが随時
// 変更する可変なUI状態)を使っていたため、ダッシュボードの表示校舎があま本部校のままだった
// 数日間、共有config(小幡校)で生成された毎朝の記事が誤ってbranch_id=2(あま本部校)として
// 保存され続けた。sync_draft_to_db.js/seo_competitor_crawl.js/seo_publisher.js/
// seo_weekly_director.js/wordpress.jsのlegacy解決はすべてgetEarliestBranch()
// (最も早く作成された校舎=小幡校相当)を使うべきで、is_activeには一切依存してはいけない。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_legacy_branch_resolution_${process.pid}.sqlite`);
process.env.JUKU_BLOG_DB_PATH = TMP_DB;

const { ROOT } = require('../scripts/lib/config');
const { closeDb, getPostBySlug } = require('../scripts/lib/db');
const branchesDb = require('../scripts/lib/branches_db');
const { resolveWpConf } = require('../scripts/lib/wordpress');

const TMP_DRAFTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'juku_blog_legacy_branch_drafts_'));

after(() => {
  closeDb();
  for (const f of [TMP_DB, `${TMP_DB}-journal`, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      // 既に無ければ無視
    }
  }
  fs.rmSync(TMP_DRAFTS_DIR, { recursive: true, force: true });
});

test('sync_draft_to_db.js: legacy実行時、ダッシュボードの表示校舎(is_active)が他校舎に切り替わっていても、常に最も早く作成された校舎(小幡校相当)へ保存する', () => {
  const earliestBranch = branchesDb.getActiveBranch(); // 唯一の初期校舎、まだis_active=1のまま
  const otherBranch = branchesDb.createBranch({ name: 'あま本部(テスト)', slug: '__test_legacy_res__' });
  branchesDb.activateBranch(otherBranch.id); // ダッシュボードで「あま本部校」に切り替えた状態を再現

  assert.equal(branchesDb.getActiveBranch().id, otherBranch.id, '前提: アクティブ校舎はotherBranchに切り替わっている');

  const draftPath = path.join(TMP_DRAFTS_DIR, '2026-07-20-legacy-resolution-check.md');
  fs.writeFileSync(
    draftPath,
    `---\ntitle: "legacy解決テスト記事"\nslug: "legacy-resolution-check"\ncategory: "地域情報"\nstatus: "verified"\n---\n本文。\n`,
    'utf8'
  );

  closeDb(); // 子プロセスからの同時アクセスに備え、親プロセス側の接続は一旦閉じる

  const env = { ...process.env };
  delete env.JUKU_BRANCH_ID; // legacy(校舎コンテキスト無し)実行を明示的に再現
  delete env.JUKU_BRANCH_SLUG;

  execFileSync('node', [path.join(ROOT, 'scripts', 'sync_draft_to_db.js'), draftPath], { cwd: ROOT, encoding: 'utf8', env });

  const saved = getPostBySlug('legacy-resolution-check');
  assert.ok(saved, '記事が保存されているべき');
  assert.equal(
    saved.branch_id,
    earliestBranch.id,
    `legacy実行はis_active(${otherBranch.id})ではなく最も早く作成された校舎(${earliestBranch.id})に保存するべき`
  );
});

test('resolveWpConf: branchId未指定(legacy)時、is_activeが他校舎に切り替わっていても最も早く作成された校舎の設定を返す', () => {
  const earliestBranch = branchesDb.getActiveBranch();
  branchesDb.updateBranch(earliestBranch.id, { wordpress_author_id: 13, wordpress_category_id: 263 });

  const otherBranch = branchesDb.createBranch({ name: 'あま本部(テスト2)', slug: '__test_legacy_res2__' });
  branchesDb.updateBranch(otherBranch.id, { wordpress_author_id: 10, wordpress_category_id: 268 });
  branchesDb.activateBranch(otherBranch.id);

  const wpConf = resolveWpConf(); // branchId未指定 = legacy
  assert.equal(wpConf.author_id, 13, 'is_activeがotherBranchでも、legacy解決は最古の校舎(小幡校相当)の設定を返すべき');
  assert.equal(wpConf.category_id, 263);
});
