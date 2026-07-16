'use strict';

// 記事生成パイプラインの複数校舎対応(Phase 1)。daily_blog.shが子プロセス(claude -p、
// 各種node scripts/*.js)へ引き継ぐ「今どの校舎向けに動いているか」のアンビエントな
// コンテキスト。JUKU_BRANCH_ID/JUKU_BRANCH_SLUGの両方は、daily_blog.shの冒頭で
// scripts/resolve_branch.jsが解決してexportする(この時点で1回だけDBを引く)ため、
// このモジュール自体はDBにもbranches_db.jsにも一切依存しない、環境変数read-onlyの
// 純粋な関数として実装する(config.js→branches_db.js→db.js→config.jsという
// 循環requireを避けるため。db.js/resolveBackfillBranchIdで確立済みの「循環を避けるため
// 依存させない」方針を踏襲する)。
//
// 未設定(通常のAPIサーバー実行や、branch引数無しのdaily_blog.sh実行)の場合は
// legacy(単一校舎)として振る舞い、既存の挙動と完全に同一のパスを返す。

const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

function getBranchContext() {
  const rawId = process.env.JUKU_BRANCH_ID;
  const slug = process.env.JUKU_BRANCH_SLUG || null;

  if (!rawId || !slug) {
    return { isLegacy: true, branchId: null, slug: null, configDir: null, dataDir: null };
  }

  const branchId = Number(rawId);
  return {
    isLegacy: false,
    branchId,
    slug,
    configDir: path.join(ROOT, 'branches', slug, 'config'),
    dataDir: path.join(ROOT, 'data', 'branches', slug),
  };
}

module.exports = { getBranchContext };
