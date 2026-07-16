'use strict';

// 記事生成パイプラインの複数校舎対応(Phase 1)の中核: config.jsのbranch-aware読み込み
// (校舎ファイル優先→共有ファイルへフォールバック)とbranch_context.jsの検証。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { test, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_branch_aware_config_${process.pid}.sqlite`);
process.env.JUKU_BLOG_DB_PATH = TMP_DB;

const { closeDb } = require('../scripts/lib/db');
const branchesDb = require('../scripts/lib/branches_db');
const config = require('../scripts/lib/config');
const { getBranchContext } = require('../scripts/lib/branch_context');

const BRANCHES_TEST_DIR = path.join(config.ROOT, 'branches', '__test_ama__', 'config');

after(() => {
  closeDb();
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    // 既に無ければ無視
  }
});

afterEach(() => {
  try {
    fs.rmSync(path.join(config.ROOT, 'branches', '__test_ama__'), { recursive: true, force: true });
  } catch {
    // 既に無ければ無視
  }
  delete process.env.JUKU_BRANCH_ID;
  delete process.env.JUKU_BRANCH_SLUG;
});

test('branches: ensureSeededで自動作成される初回校舎は必ずslugを持つ(NULLのまま残らない)', () => {
  const branches = branchesDb.listBranches();
  assert.equal(branches.length, 1);
  assert.ok(branches[0].slug, 'slugがNULL/空のまま残ってはいけない');
});

test('branch_context: 環境変数未設定ならlegacyを返す', () => {
  const ctx = getBranchContext();
  assert.equal(ctx.isLegacy, true);
  assert.equal(ctx.configDir, null);
});

test('branch_context: JUKU_BRANCH_ID/JUKU_BRANCH_SLUGが揃っていればlegacyでなくなる', () => {
  process.env.JUKU_BRANCH_ID = '2';
  process.env.JUKU_BRANCH_SLUG = 'ama';
  const ctx = getBranchContext();
  assert.equal(ctx.isLegacy, false);
  assert.equal(ctx.branchId, 2);
  assert.equal(ctx.slug, 'ama');
  assert.ok(ctx.configDir.endsWith(path.join('branches', 'ama', 'config')));
});

test('resolveYamlSource: 最初に作成された校舎(小幡校相当)は、校舎別ファイルが無くても共有config自体を「自分の設定」として扱いisSharedFallback=falseを返す', () => {
  const branch = branchesDb.getActiveBranch();
  const source = config.resolveYamlSource('config/calendar.yaml', branch.id);
  assert.equal(source.isSharedFallback, false, '小幡校自身が共有configの本来の持ち主であり、フォールバック扱いにしてはいけない');
  assert.equal(source.absPath, path.join(config.ROOT, 'config', 'calendar.yaml'));
});

test('resolveYamlSource: 後から追加された校舎(あま本部相当)で校舎別ファイルが無ければ共有ファイルへフォールバックし、isSharedFallback=trueを返す', () => {
  const newBranch = branchesDb.createBranch({ name: 'あま本部' }, '2026-07-16T00:00:00.000Z');
  const source = config.resolveYamlSource('config/calendar.yaml', newBranch.id);
  assert.equal(source.isSharedFallback, true, '最初の校舎ではないため、共有configの利用は参考表示(フォールバック)扱いにするべき');
  assert.equal(source.absPath, path.join(config.ROOT, 'config', 'calendar.yaml'));
});

test('resolveYamlSource: 明示branchIdで校舎別ファイルが存在すればそちらを優先し、isSharedFallback=falseを返す', () => {
  const branch = branchesDb.getActiveBranch();
  branchesDb.updateBranch(branch.id, { slug: '__test_ama__' });
  fs.mkdirSync(BRANCHES_TEST_DIR, { recursive: true });
  fs.writeFileSync(path.join(BRANCHES_TEST_DIR, 'calendar.yaml'), 'weekdays: {}\nseasons: []\n', 'utf8');

  const source = config.resolveYamlSource('config/calendar.yaml', branch.id);
  assert.equal(source.isSharedFallback, false);
  assert.equal(source.absPath, path.join(BRANCHES_TEST_DIR, 'calendar.yaml'));
});

test('resolveYamlSource: branchId未指定・env未設定ならlegacy(共有のみ、isSharedFallback=false)', () => {
  const source = config.resolveYamlSource('config/calendar.yaml');
  assert.equal(source.isSharedFallback, false);
  assert.equal(source.absPath, path.join(config.ROOT, 'config', 'calendar.yaml'));
});

test('loadJukuConfig: アンビエントコンテキスト(env)経由で校舎別juku.yamlが無い場合はハードエラーになる(暗黙フォールバック禁止)', () => {
  process.env.JUKU_BRANCH_ID = '999';
  process.env.JUKU_BRANCH_SLUG = '__nonexistent_slug__';
  assert.throws(() => config.loadJukuConfig(), /juku\.yamlが見つかりません/);
});

test('loadJukuConfig: 明示branchId経由(ダッシュボードAPI相当)は校舎別juku.yamlが無くても共有設定へフォールバックする', () => {
  const branch = branchesDb.getActiveBranch();
  const juku = config.loadJukuConfig(branch.id);
  assert.ok(juku && juku.juku, '共有juku.yamlの内容が返るべき(エラーにならない)');
});

test('loadCalendarConfig/loadSchoolPagesConfig等: branchId未指定は従来通り共有ファイルを返す(後方互換)', () => {
  const calendar = config.loadCalendarConfig();
  assert.ok(calendar && calendar.weekdays, '既存の共有config/calendar.yamlの内容が返るべき');
});
