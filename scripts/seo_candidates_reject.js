'use strict';

// キーワード候補の除外(CLI)。
//
// 使い方: node scripts/seo_candidates_reject.js <candidate_id> "除外理由"

const seoDb = require('./lib/seo_db');

function main() {
  const id = Number(process.argv[2]);
  const reason = process.argv[3] || null;
  if (!id) {
    console.error('使い方: node scripts/seo_candidates_reject.js <candidate_id> "除外理由"');
    process.exit(1);
  }

  const candidate = seoDb.getKeywordCandidateById(id);
  if (!candidate) {
    console.error(`[seo_candidates_reject] candidate id=${id} が見つかりません`);
    process.exit(1);
  }

  const nowIso = new Date().toISOString();
  const result = seoDb.updateCandidateStatus(id, { toStatus: 'rejected', reason, actor: 'dashboard' }, nowIso);
  console.log(`[seo_candidates_reject] candidate id=${id}: ${result.from} → ${result.to}`);
}

if (require.main === module) {
  main();
}

module.exports = { main };
