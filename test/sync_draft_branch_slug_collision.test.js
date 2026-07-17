'use strict';

// 2026-07-17判明した実インシデントの回帰テスト: sync_draft_to_db.jsがslugのみで
// 既存postを検索していたため、あま本部校(branch 2)の記事が偶然にも小幡校(branch 1)の
// 既存の予約済み記事と同じslugを生成した際、branch_idを見ずに無条件で
// updatePostBySlugを呼んでしまい、小幡校の実記事(title/body/status)がまるごと
// あま本部校の内容で上書きされる実害が発生した(本番postsテーブルで発生、
// バックアップからの手動復旧で対応した)。
//
// 修正: (a) DB/WordPress向けslugはlegacy以外の校舎で校舎slugを前置する(toDbSlug)、
// (b) 既存postのbranch_idが解決したbranch_idと異なる場合は「衝突」として明確に
// 停止する(サイレントな上書きをしない)。本ファイルはこの両方を検証する。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_slug_collision_${process.pid}.sqlite`);
process.env.JUKU_BLOG_DB_PATH = TMP_DB;

const { ROOT } = require('../scripts/lib/config');
const { insertPost, getPostBySlug, closeDb } = require('../scripts/lib/db');
const branchesDb = require('../scripts/lib/branches_db');

const TMP_DRAFTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'juku_blog_slug_collision_drafts_'));

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

function writeDraft(filename, frontmatter) {
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n');
  const filePath = path.join(TMP_DRAFTS_DIR, filename);
  fs.writeFileSync(filePath, `---\n${fm}\n---\n本文テキスト。\n`, 'utf8');
  return filePath;
}

function runSync(filePath, branch) {
  return execFileSync('node', [path.join(ROOT, 'scripts', 'sync_draft_to_db.js'), filePath], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      JUKU_BRANCH_ID: String(branch.id),
      JUKU_BRANCH_SLUG: branch.slug,
    },
  });
}

test('sync_draft_to_db.js: 別校舎の記事が同じ生slugを生成しても、既存記事(scheduled)を上書きせず、prefix付きslugで新規登録する', () => {
  // branch 1 相当(getDb()初回呼び出しで自動作成される最古の校舎)
  const branch1 = branchesDb.getActiveBranch();
  const branch2 = branchesDb.createBranch({ name: 'あま本部(テスト)', slug: '__test_ama_sync__' });

  const nowIso = '2026-07-15T20:13:30.300Z';
  insertPost({
    created_at: nowIso,
    title: '既存(小幡校)の記事',
    slug: 'natsuyasumi-mae-gakushu-check',
    category: '保護者コラム',
    body_md: '小幡校の本文',
    body_html: '<p>小幡校の本文</p>',
    status: 'scheduled',
    branch_id: branch1.id,
  });

  closeDb(); // Windowsでの子プロセスからの同時アクセスに備え、親プロセス側の接続は一旦閉じる

  const draftPath = writeDraft('2026-07-17-natsuyasumi-mae-gakushu-check.md', {
    title: 'あま本部校の記事',
    slug: 'natsuyasumi-mae-gakushu-check', // branch1の既存記事と全く同じ生slug
    category: '保護者コラム',
    status: 'verified',
  });

  const output = runSync(draftPath, branch2);
  assert.match(output, /新規登録しました/, '既存記事の更新ではなく新規登録になるべき');

  const branch1Post = getPostBySlug('natsuyasumi-mae-gakushu-check');
  assert.equal(branch1Post.status, 'scheduled', '小幡校の既存記事のstatusが上書きされてはいけない');
  assert.equal(branch1Post.title, '既存(小幡校)の記事', '小幡校の既存記事のtitleが上書きされてはいけない');
  assert.equal(branch1Post.branch_id, branch1.id);

  const branch2Post = getPostBySlug(`${branch2.slug}-natsuyasumi-mae-gakushu-check`);
  assert.ok(branch2Post, 'prefix付きslugであま本部校の記事が新規登録されているべき');
  assert.equal(branch2Post.status, 'review_pending');
  assert.equal(branch2Post.title, 'あま本部校の記事');
  assert.equal(branch2Post.branch_id, branch2.id);
});

test('sync_draft_to_db.js: prefix後のslugすら別校舎で衝突していた場合はサイレントに上書きせずエラー終了する', () => {
  const branch1 = branchesDb.getActiveBranch();
  const branch3 = branchesDb.createBranch({ name: '第3校舎(テスト)', slug: '__test_branch3_sync__' });

  const nowIso = '2026-07-10T00:00:00.000Z';
  insertPost({
    created_at: nowIso,
    title: '衝突させる既存記事(branch1)',
    slug: `${branch3.slug}-collide-slug`, // branch3が生成するprefix付きslugと意図的に同じにする
    category: '地域情報',
    body_md: '本文',
    body_html: '<p>本文</p>',
    status: 'approved',
    branch_id: branch1.id,
  });

  closeDb();

  const draftPath = writeDraft('2026-07-17-collide-slug.md', {
    title: '衝突する新規記事(branch3)',
    slug: 'collide-slug',
    category: '地域情報',
    status: 'verified',
  });

  assert.throws(() => runSync(draftPath, branch3), (err) => {
    const combined = `${err.stdout || ''}${err.stderr || ''}`;
    assert.match(combined, /衝突/);
    return true;
  });

  const collided = getPostBySlug(`${branch3.slug}-collide-slug`);
  assert.equal(collided.status, 'approved', '衝突を検知した場合、既存記事の内容は一切変更されてはいけない');
  assert.equal(collided.branch_id, branch1.id);
});
