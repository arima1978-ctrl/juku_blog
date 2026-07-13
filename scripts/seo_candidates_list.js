'use strict';

// キーワード候補の一覧表示(CLI)。ダッシュボード未実装時でも状況確認できるようにする。
//
// 使い方:
//   node scripts/seo_candidates_list.js [--status=discovered] [--gap-type=missing]
//                                        [--min-score=70] [--order-by=priority_score]

const seoDb = require('./lib/seo_db');

function parseArgs(argv) {
  const get = (prefix) => {
    const arg = argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
  };
  return {
    status: get('--status='),
    gapType: get('--gap-type='),
    minPriorityScore: get('--min-score=') ? Number(get('--min-score=')) : undefined,
    orderBy: get('--order-by='),
  };
}

function main() {
  const filters = parseArgs(process.argv.slice(2));
  const candidates = seoDb.listKeywordCandidates(filters);

  if (candidates.length === 0) {
    console.log('[seo_candidates_list] 条件に一致する候補はありません');
    return;
  }

  console.log(`id\tpriority_score\tgap_type\tstatus\trecommended_action\tnormalized_keyword`);
  for (const c of candidates) {
    console.log(`${c.id}\t${c.priority_score}\t${c.gap_type}\t${c.status}\t${c.recommended_action || ''}\t${c.normalized_keyword}`);
  }
  console.log(`[seo_candidates_list] ${candidates.length}件`);
}

if (require.main === module) {
  main();
}

module.exports = { main };
