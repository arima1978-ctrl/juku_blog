'use strict';

// 複数校舎管理(プランA)のDB層テスト。migration(新規DB/既存DBへのbranchesテーブル追加)・
// 初回シード・CRUD・is_active不変条件(常に1件のみ)を検証する。

const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const TMP_CONFIG = path.join(os.tmpdir(), `juku_blog_branches_db_config_${process.pid}.yaml`);
const TMP_DB = path.join(os.tmpdir(), `juku_blog_branches_db_test_${process.pid}.sqlite`);

// config/juku.yamlの実ファイルをそのまま使うと他テストとの並行実行で値が変わりうるため、
// シード検証専用の最小configを一時ファイルとして用意する(既存のJUKU_BLOG_CONFIG_PATH
// オーバーライドの仕組みをそのまま使う)。
fs.writeFileSync(
  TMP_CONFIG,
  `juku:\n  name: "シードテスト校"\narea:\n  city: "テスト市"\nwordpress:\n  category_id: 1\n  author_id: 999\n  author_display_name: "テスト太郎"\n`,
  'utf8'
);
process.env.JUKU_BLOG_CONFIG_PATH = TMP_CONFIG;
process.env.JUKU_BLOG_DB_PATH = TMP_DB;

const { closeDb } = require('../scripts/lib/db');
const branchesDb = require('../scripts/lib/branches_db');

after(() => {
  closeDb();
  [TMP_CONFIG, TMP_DB].forEach((f) => {
    try {
      fs.unlinkSync(f);
    } catch {
      // 既に無ければ無視
    }
  });
});

test('初回アクセス時、config/juku.yamlの現在値から1件目が自動シードされる', () => {
  const branches = branchesDb.listBranches();
  assert.equal(branches.length, 1);
  assert.equal(branches[0].name, 'シードテスト校');
  assert.equal(branches[0].target_area, 'テスト市');
  assert.equal(branches[0].wordpress_author_id, 999);
  assert.equal(branches[0].wordpress_author_display_name, 'テスト太郎');
  assert.equal(branches[0].is_active, true);
});

test('シードは1回のみ実行される(2回目のlistBranchesで重複投入されない)', () => {
  const branches = branchesDb.listBranches();
  assert.equal(branches.length, 1);
});

test('getActiveBranch: is_active=1の校舎を返す', () => {
  const active = branchesDb.getActiveBranch();
  assert.equal(active.name, 'シードテスト校');
});

test('createBranch: 新規校舎はis_active=falseで作成される', () => {
  const branch = branchesDb.createBranch({
    name: '瓢箪山校',
    target_area: '瓢箪山',
    wordpress_author_id: 20,
    wordpress_author_display_name: '山田太郎',
    wordpress_api_token: 'dummy-token',
  });
  assert.equal(branch.name, '瓢箪山校');
  assert.equal(branch.is_active, false);
  assert.equal(branch.wordpress_api_token, 'dummy-token');
  global.__createdBranchId = branch.id;
});

test('listBranches: 作成順(id昇順)で全件返る', () => {
  const branches = branchesDb.listBranches();
  assert.equal(branches.length, 2);
  assert.equal(branches[1].id, global.__createdBranchId);
});

test('updateBranch: 指定したフィールドのみ更新される', () => {
  const updated = branchesDb.updateBranch(global.__createdBranchId, { target_area: '瓢箪山駅前' });
  assert.equal(updated.target_area, '瓢箪山駅前');
  assert.equal(updated.name, '瓢箪山校', '指定していないフィールドは変化しない');
});

test('updateBranch: 存在しないIDはnullを返す', () => {
  assert.equal(branchesDb.updateBranch(999999, { name: 'x' }), null);
});

test('activateBranch: is_active=1は常に1件のみになる(不変条件)', () => {
  const result = branchesDb.activateBranch(global.__createdBranchId);
  assert.equal(result.ok, true);
  assert.equal(result.branch.is_active, true);

  const branches = branchesDb.listBranches();
  const activeCount = branches.filter((b) => b.is_active).length;
  assert.equal(activeCount, 1);
  assert.equal(branches.find((b) => b.id === global.__createdBranchId).is_active, true);
  assert.equal(branches.find((b) => b.id !== global.__createdBranchId).is_active, false);
});

test('activateBranch: 存在しないIDはnot_foundを返す', () => {
  const result = branchesDb.activateBranch(999999);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_found');
});

test('deleteBranch: アクティブな校舎は削除できない', () => {
  const result = branchesDb.deleteBranch(global.__createdBranchId);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'cannot_delete_active_branch');
});

test('deleteBranch: 非アクティブな校舎は削除できる', () => {
  const nonActive = branchesDb.listBranches().find((b) => !b.is_active);
  const result = branchesDb.deleteBranch(nonActive.id);
  assert.equal(result.ok, true);
  assert.equal(branchesDb.getBranchById(nonActive.id), null);
});

test('deleteBranch: 存在しないIDはnot_foundを返す', () => {
  const result = branchesDb.deleteBranch(999999);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_found');
});
