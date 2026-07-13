'use strict';

// キーワード候補の承認(CLI)。承認しても記事生成へは自動で渡らない
// (use_for_topic_selectionがtrueの場合のみ智谷が候補として参照する。
// 記事生成キューへの登録は別途 seo_candidates_queue で行う想定)。
//
// 使い方: node scripts/seo_candidates_approve.js <candidate_id> ["承認理由"]

const seoDb = require('./lib/seo_db');

function main() {
  const id = Number(process.argv[2]);
  const reason = process.argv[3] || null;
  if (!id) {
    console.error('使い方: node scripts/seo_candidates_approve.js <candidate_id> ["承認理由"]');
    process.exit(1);
  }

  const candidate = seoDb.getKeywordCandidateById(id);
  if (!candidate) {
    console.error(`[seo_candidates_approve] candidate id=${id} が見つかりません`);
    process.exit(1);
  }

  const nowIso = new Date().toISOString();
  const result = seoDb.updateCandidateStatus(id, { toStatus: 'approved', reason, actor: 'dashboard' }, nowIso);
  console.log(`[seo_candidates_approve] candidate id=${id}: ${result.from} → ${result.to}`);
}

if (require.main === module) {
  main();
}

module.exports = { main };
