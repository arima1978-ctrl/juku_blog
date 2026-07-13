'use strict';

// 承認済み(approved)候補を記事生成キューへ送る(status: approved → queued)。
// queuedへの遷移はapproved状態からのみ許可される(二重キュー登録防止。scripts/lib/seo_db.js参照)。
//
// 使い方: node scripts/seo_candidates_queue.js <candidate_id>

const seoDb = require('./lib/seo_db');

function main() {
  const id = Number(process.argv[2]);
  if (!id) {
    console.error('使い方: node scripts/seo_candidates_queue.js <candidate_id>');
    process.exit(1);
  }

  const candidate = seoDb.getKeywordCandidateById(id);
  if (!candidate) {
    console.error(`[seo_candidates_queue] candidate id=${id} が見つかりません`);
    process.exit(1);
  }

  const nowIso = new Date().toISOString();
  try {
    const result = seoDb.updateCandidateStatus(id, { toStatus: 'queued', actor: 'dashboard' }, nowIso);
    console.log(`[seo_candidates_queue] candidate id=${id}: ${result.from} → ${result.to}`);
  } catch (err) {
    console.error(`[seo_candidates_queue] ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
