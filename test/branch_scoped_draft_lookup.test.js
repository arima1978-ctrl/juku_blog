'use strict';

// 2026-07-17判明した実インシデントの回帰テスト: daily_blog.sh <branch-slug> 実行時、
// 赤羽(editor-btoc)・石橋(verifier-local)・sync_draft_to_db.js が共有 data/drafts/ 配下の
// 無関係な(別校舎の)ドラフトを誤って対象にしてしまい、あま本部校のテスト生成中に
// 小幡校の既存記事を巻き込みかけた。findDraftForDate()にdraftsDir引数を追加し、
// get_draft_status.jsが校舎コンテキストに応じて正しいディレクトリを渡すようにする修正の
// 回帰防止テスト。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { test, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const { ROOT } = require('../scripts/lib/config');
const { findDraftForDate, DRAFTS_DIR } = require('../scripts/lib/draft');

const TEST_SLUG = '__test_branch_scoped_draft__';
const BRANCH_DRAFTS_DIR = path.join(ROOT, 'data', 'branches', TEST_SLUG, 'drafts');
const DATE = '2026-07-17';

const SHARED_FRONTMATTER = `---
title: "共有(小幡校)の既存記事"
slug: "shared-branch-post"
category: "地域情報"
status: "verified"
---
共有側の本文。
`;

const BRANCH_FRONTMATTER = `---
title: "あま本部校の記事"
slug: "ama-honbu-post"
category: "地域情報"
status: "written"
---
校舎スコープ側の本文。
`;

function cleanup() {
  try {
    fs.rmSync(path.join(ROOT, 'data', 'drafts', `${DATE}-shared-post.md`), { force: true });
  } catch {
    // 既に無ければ無視
  }
  try {
    fs.rmSync(path.join(ROOT, 'data', 'branches', TEST_SLUG), { recursive: true, force: true });
  } catch {
    // 既に無ければ無視
  }
}

afterEach(cleanup);
after(cleanup);

test('findDraftForDate: draftsDirを明示すればそのディレクトリのみを見る(デフォルトは従来通り共有DRAFTS_DIR)', () => {
  fs.mkdirSync(path.dirname(path.join(ROOT, 'data', 'drafts', 'x')), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'data', 'drafts', `${DATE}-shared-post.md`), SHARED_FRONTMATTER, 'utf8');
  fs.mkdirSync(BRANCH_DRAFTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(BRANCH_DRAFTS_DIR, `${DATE}-ama-honbu-post.md`), BRANCH_FRONTMATTER, 'utf8');

  const defaultResult = findDraftForDate(DATE);
  assert.equal(defaultResult.frontmatter.slug, 'shared-branch-post', 'draftsDir省略時は従来通り共有DRAFTS_DIRを見るべき');

  const branchResult = findDraftForDate(DATE, BRANCH_DRAFTS_DIR);
  assert.equal(branchResult.frontmatter.slug, 'ama-honbu-post', '明示したdraftsDir配下のファイルだけを見るべき');
});

test('findDraftForDate: DRAFTS_DIRエクスポートは共有ディレクトリのパスと一致する(後方互換の確認)', () => {
  assert.equal(DRAFTS_DIR, path.join(ROOT, 'data', 'drafts'));
});

test('get_draft_status.js CLI: 校舎コンテキスト(env)が設定されていれば、同日に共有側の無関係なdraftが存在していても校舎別ディレクトリのdraftを返す(2026-07-17の実インシデントの再現・回帰防止)', () => {
  fs.mkdirSync(path.join(ROOT, 'data', 'drafts'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'data', 'drafts', `${DATE}-shared-post.md`), SHARED_FRONTMATTER, 'utf8');
  fs.mkdirSync(BRANCH_DRAFTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(BRANCH_DRAFTS_DIR, `${DATE}-ama-honbu-post.md`), BRANCH_FRONTMATTER, 'utf8');

  const output = execFileSync(
    'node',
    [path.join(ROOT, 'scripts', 'get_draft_status.js'), DATE],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, JUKU_BRANCH_ID: '999999', JUKU_BRANCH_SLUG: TEST_SLUG },
    }
  );

  const [status, filePath] = output.trim().split('\t');
  assert.equal(status, 'written');
  assert.ok(
    filePath.includes(path.join('data', 'branches', TEST_SLUG, 'drafts')),
    `校舎別ディレクトリのdraftを返すべきだが実際は: ${filePath}`
  );
  assert.ok(!filePath.includes(path.join('data', 'drafts', `${DATE}-shared-post.md`)), '共有側の無関係なdraftを返してはいけない');
});

test('get_draft_status.js CLI: 校舎コンテキスト未設定(legacy)なら従来通り共有data/drafts/を見る(既存挙動を壊さない)', () => {
  fs.mkdirSync(path.join(ROOT, 'data', 'drafts'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'data', 'drafts', `${DATE}-shared-post.md`), SHARED_FRONTMATTER, 'utf8');

  const env = { ...process.env };
  delete env.JUKU_BRANCH_ID;
  delete env.JUKU_BRANCH_SLUG;

  const output = execFileSync('node', [path.join(ROOT, 'scripts', 'get_draft_status.js'), DATE], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
  });

  const [status, filePath] = output.trim().split('\t');
  assert.equal(status, 'verified');
  assert.ok(filePath.endsWith(`${DATE}-shared-post.md`));
});
