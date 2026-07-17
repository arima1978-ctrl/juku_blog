'use strict';

// 2026-07-17判明した実インシデントの回帰テスト: resolveWpConf()がbranchIdを一切受け取らず、
// ダッシュボードで「現在アクティブな校舎」(グローバルな可変トグル)を見ていたため、
// あま本部校の記事を投稿する瞬間にダッシュボードの表示が小幡校に切り替わっていると、
// 投稿者名・カテゴリーが小幡校のものになってしまう実害が発生した(あま本部校の記事が
// 投稿者=米澤由里子・カテゴリー=小幡校のコラムとしてWordPressへ同期されたインシデント)。
//
// 修正: resolveWpConf(branchId) が投稿対象(post.branch_id)を明示的に受け取り、
// ダッシュボードのアクティブ校舎トグルとは完全に独立して校舎別設定を解決するようにした。
// category_idも(以前は共有config固定だったが)branches.wordpress_category_idから解決する。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_wp_resolve_conf_${process.pid}.sqlite`);
process.env.JUKU_BLOG_DB_PATH = TMP_DB;

const { closeDb } = require('../scripts/lib/db');
const branchesDb = require('../scripts/lib/branches_db');
const { resolveWpConf } = require('../scripts/lib/wordpress');

after(() => {
  closeDb();
  for (const f of [TMP_DB, `${TMP_DB}-journal`, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      // 既に無ければ無視
    }
  }
});

test('resolveWpConf: branchIdを明示すれば、ダッシュボードの現在アクティブな校舎に関わらずその校舎自身の設定を返す(実インシデントの回帰確認)', () => {
  const legacyBranch = branchesDb.getActiveBranch(); // 最初の校舎(小幡校相当)、以後アクティブなまま
  const created = branchesDb.createBranch({
    name: 'あま本部(テスト)',
    slug: '__test_wp_resolve__',
    wordpress_author_id: 99,
    wordpress_author_display_name: '山口誠司(テスト)',
  });
  // wordpress_category_idはcreateBranch()のINSERT対象列に含まれないため、updateBranchで設定する
  const otherBranch = branchesDb.updateBranch(created.id, { wordpress_category_id: 268 });

  // ダッシュボードの「現在アクティブな校舎」は依然としてlegacyBranch(小幡校)のまま
  // (createBranchはis_active=0で作成されるため、activateしない限り切り替わらない)。
  assert.equal(branchesDb.getActiveBranch().id, legacyBranch.id, '前提: アクティブな校舎はlegacyBranchのまま');

  const wpConf = resolveWpConf(otherBranch.id);
  assert.equal(wpConf.author_id, 99, 'アクティブ校舎(小幡)ではなく、明示的に渡したotherBranch自身の投稿者IDを返すべき');
  assert.equal(wpConf.author_display_name, '山口誠司(テスト)');
  assert.equal(wpConf.category_id, 268, 'カテゴリーIDも校舎ごとに解決されるべき(以前は共有config固定だった)');
});

test('resolveWpConf: branchId未指定(legacy呼び出し)は従来通りアクティブな校舎を返す(既存挙動を壊さない)', () => {
  const activeBranch = branchesDb.getActiveBranch();
  const wpConf = resolveWpConf();
  assert.equal(wpConf.author_id, activeBranch.wordpress_author_id ?? wpConf.author_id);
});

test('resolveWpConf: 校舎にwordpress_category_id等が未設定(null)なら共有config/juku.yamlの値へフォールバックする', () => {
  const branchNoOverride = branchesDb.createBranch({ name: '設定未投入の校舎(テスト)', slug: '__test_wp_resolve_none__' });
  const wpConf = resolveWpConf(branchNoOverride.id);
  // 校舎自身にwordpress_category_id等が無ければ共有config(config/juku.yaml)の値が使われる
  assert.ok(wpConf.category_id, '校舎に設定が無い場合、共有config由来の値にフォールバックするべき(undefinedのままではない)');
});

test('resolveWpConf: 存在しないbranchIdを渡した場合は共有configへフォールバックする(例外を投げない)', () => {
  const wpConf = resolveWpConf(999999);
  assert.ok(wpConf, '存在しないbranchIdでも例外を投げず共有configを返すべき');
});
