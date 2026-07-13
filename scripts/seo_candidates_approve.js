'use strict';

// キーワード候補の承認(CLI)。承認時にaction(新規記事/既存記事改善/校舎ページ改善)を
// 確定させる(approved_action)。承認しても記事生成へは自動で渡らない
// (use_for_topic_selectionがtrueかつapproved_action=create_articleの場合のみ、
// 智谷が候補として参照する。記事生成キューへの登録は別途 seo_candidates_queue で行う想定)。
//
// 使い方: node scripts/seo_candidates_approve.js <candidate_id> [action] ["承認理由"]
//   action: create_article(既定) / improve_existing_article / improve_school_page

const seoDb = require('./lib/seo_db');

const APPROVABLE_ACTIONS = new Set(['create_article', 'improve_existing_article', 'improve_school_page']);

function main() {
  const id = Number(process.argv[2]);
  const actionArg = APPROVABLE_ACTIONS.has(process.argv[3]) ? process.argv[3] : null;
  const action = actionArg || 'create_article';
  const reason = (actionArg ? process.argv[4] : process.argv[3]) || null;

  if (!id) {
    console.error('使い方: node scripts/seo_candidates_approve.js <candidate_id> [action] ["承認理由"]');
    process.exit(1);
  }

  const candidate = seoDb.getKeywordCandidateById(id);
  if (!candidate) {
    console.error(`[seo_candidates_approve] candidate id=${id} が見つかりません`);
    process.exit(1);
  }

  const nowIso = new Date().toISOString();
  const result = seoDb.updateCandidateStatus(id, { toStatus: 'approved', reason, actor: 'dashboard', approvedAction: action }, nowIso);
  console.log(`[seo_candidates_approve] candidate id=${id}: ${result.from} → ${result.to} (action=${action})`);
}

if (require.main === module) {
  main();
}

module.exports = { main };
