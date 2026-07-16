'use strict';

// 記事生成パイプラインの複数校舎対応(Phase 1)。daily_blog.shが引数で受け取ったslugを
// 校舎IDへ解決するための小さなCLI。標準出力に "id" だけを1行出す(bashの$(...)で
// そのまま拾える形)。見つからなければ非ゼロ終了する。
//
// 使い方: node scripts/resolve_branch.js <slug>

const branchesDb = require('./lib/branches_db');

function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('使い方: node scripts/resolve_branch.js <slug>');
    process.exit(1);
  }

  const branch = branchesDb.getBranchBySlug(slug);
  if (!branch) {
    console.error(`[resolve_branch] slug="${slug}" に該当する校舎が見つかりません`);
    process.exit(1);
  }

  console.log(branch.id);
}

if (require.main === module) {
  main();
}

module.exports = { main };
