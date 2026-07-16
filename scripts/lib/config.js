'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..', '..');

// 記事生成パイプラインの複数校舎対応(Phase 1)。branchIdが明示された場合はDBから
// 該当校舎のslugを引いてbranches/<slug>/config/を、未指定の場合はbranch_context.js
// (daily_blog.sh配下の環境変数によるアンビエントコンテキスト)を見る。どちらも
// 無ければ従来通りnull(=共有configのみ使用、legacy)を返す。
// branches_db.jsはdb.jsを経由してconfig.js自身に依存する(config.js→branches_db.js→
// db.js→config.jsの循環)ため、モジュール読み込み時ではなく呼び出し時にのみ
// require する(db.jsのresolveBackfillBranchIdで確立済みの回避パターンと同じ)。
function resolveBranchConfigDir(branchId) {
  if (branchId !== undefined && branchId !== null) {
    const branchesDb = require('./branches_db');
    const branch = branchesDb.getBranchById(branchId);
    // branch.slugが無い(まだ校舎専用ディレクトリを持てない)場合もconfigDirはnullになるが、
    // 「校舎コンテキストは有効(=共有設定へのフォールバックとして扱うべき)」ことは
    // branchContextActiveで区別して呼び出し元に伝える。
    const configDir = branch && branch.slug ? path.join(ROOT, 'branches', branch.slug, 'config') : null;
    return { configDir, branchContextActive: Boolean(branch), resolvedBranchId: branch ? branch.id : null };
  }
  const { getBranchContext } = require('./branch_context');
  const ctx = getBranchContext();
  return {
    configDir: ctx.isLegacy ? null : ctx.configDir,
    branchContextActive: !ctx.isLegacy,
    resolvedBranchId: ctx.isLegacy ? null : ctx.branchId,
  };
}

// 最初に作成された校舎(id最小)かどうか。共有config/*.yamlは元々この校舎向けに
// 書かれた内容そのものであり、まだbranches/<slug>/へ物理的に移行していないだけなので、
// この校舎から見た場合は「フォールバック」ではなく「自分の設定を見ている」扱いにする
// (db.jsのresolveBackfillBranchIdと同じ「最初の校舎=単一テナント時代の本来の持ち主」という考え方)。
function isEarliestBranch(branchId) {
  const branchesDb = require('./branches_db');
  const branches = branchesDb.listBranches();
  return branches.length > 0 && branches[0].id === branchId;
}

// relPathの実際の読み込み元と、共有config(校舎別ファイルが無くフォールバックしたか)を
// 判定する。ダッシュボードのテーマカレンダー等、「これは校舎専用の設定なのか、
// 共有設定を参考表示しているだけなのか」をUIに伝える必要がある呼び出し元向け。
function resolveYamlSource(relPath, branchId) {
  const { configDir, branchContextActive, resolvedBranchId } = resolveBranchConfigDir(branchId);
  if (configDir) {
    const branchAbs = path.join(configDir, path.basename(relPath));
    if (fs.existsSync(branchAbs)) {
      return { absPath: branchAbs, isSharedFallback: false };
    }
  }
  const isFallback = branchContextActive && !(resolvedBranchId !== null && isEarliestBranch(resolvedBranchId));
  return { absPath: path.join(ROOT, relPath), isSharedFallback: isFallback };
}

// branchId: 明示指定(ダッシュボードAPI等)。省略時はbranch_context.js経由の
// アンビエントコンテキスト(CLI/daily_blog.sh)。どちらも無ければ従来通り共有configのみ。
function loadYaml(relPath, branchId) {
  const { absPath } = resolveYamlSource(relPath, branchId);
  return yaml.load(fs.readFileSync(absPath, 'utf8'));
}

// テスト時のみ、JUKU_BLOG_CONFIG_PATH で本番設定(config/juku.yaml)と別の一時ファイルを
// 指定できるようにする(JUKU_BLOG_DB_PATHと同じ方針。Feature Flag有効時の挙動を
// 結合テストで検証する際、共有ファイルである本番configを書き換えずに済むようにするため)。
// この上書きはbranch解決より常に優先する。
function loadJukuConfig(branchId) {
  if (process.env.JUKU_BLOG_CONFIG_PATH) {
    return yaml.load(fs.readFileSync(process.env.JUKU_BLOG_CONFIG_PATH, 'utf8'));
  }
  // juku.yaml(ペルソナ・商圏)のみ、CLIパイプライン(アンビエントコンテキスト)経由の場合は
  // 共有ファイルへの暗黙フォールバックを許可しない(誤ったペルソナ・学校名で記事が
  // 生成される事故を防ぐ)。ダッシュボードAPI(明示branchId)経由は、まだ校舎別juku.yaml
  // が無くても共有設定を参考表示できるよう、フォールバックを許可する。
  if (branchId === undefined || branchId === null) {
    const { getBranchContext } = require('./branch_context');
    const ctx = getBranchContext();
    if (!ctx.isLegacy) {
      const branchAbs = path.join(ctx.configDir, 'juku.yaml');
      if (!fs.existsSync(branchAbs)) {
        throw new Error(
          `[config] 校舎コンテキスト(slug=${ctx.slug})向けのjuku.yamlが見つかりません: ${branchAbs} ` +
            '(記事生成には校舎専用のペルソナ・商圏設定が必須です。共有configへは自動フォールバックしません)'
        );
      }
      return yaml.load(fs.readFileSync(branchAbs, 'utf8'));
    }
  }
  return loadYaml('config/juku.yaml', branchId);
}

function loadCalendarConfig(branchId) {
  return loadYaml('config/calendar.yaml', branchId);
}

function loadExamSourcesConfig(branchId) {
  return loadYaml('config/aichi_exam_sources.yaml', branchId);
}

function loadSeoCompetitorsConfig(branchId) {
  return loadYaml('config/seo_competitors.yaml', branchId);
}

// 自社の校舎ページ(固定ページ)レジストリ。競合設定(loadSeoCompetitorsConfig)とは
// 完全に分離されたファイル。詳細はscripts/lib/seo/school_page_registry.js参照。
function loadSchoolPagesConfig(branchId) {
  return loadYaml('config/school_pages.yaml', branchId);
}

module.exports = {
  ROOT,
  loadYaml,
  resolveYamlSource,
  loadJukuConfig,
  loadCalendarConfig,
  loadExamSourcesConfig,
  loadSeoCompetitorsConfig,
  loadSchoolPagesConfig,
};
