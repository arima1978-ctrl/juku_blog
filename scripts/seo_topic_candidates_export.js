'use strict';

// 智谷(planner-blog-btoc)へ承認済みキーワード候補を橋渡しする決定的スクリプト(LLM不使用)。
// features.competitor_keyword_analysis.enabled と .use_for_topic_selection が両方trueで、
// かつ承認済み(approved)またはキュー投入済み(queued。ダッシュボードの「キューへ送る」操作で
// approved→queuedへ遷移した候補。2026-07-29判明: 以前はapprovedのみを見ており、queuedへ
// 遷移した候補が選定対象から漏れ、記事が永遠に生成されない不具合があった)かつ
// approved_action='create_article'の候補が1件以上ある場合のみ
// data/seo_candidates/YYYY-MM-DD.json を出力する。それ以外(機能OFF・候補0件)は何も出力しない
// (improve_existing_article/improve_school_pageとして承認された候補は自動記事生成へ渡さず、
// ダッシュボード上の改善タスクとして別途管理する)。
// (愛知県高校入試機能のfetch_exam_research.jsと同じ「無ければ何も作らない」設計。
// 智谷はこのファイルが存在しない日は完全に無視するため、既存の企画ロジックに影響しない)。
//
// このファイルは候補のステータスを変更しない(あくまで智谷への提示用)。
// 実際に智谷が採用した候補は、data/plans/YYYY-MM-DD.jsonのseo_candidate_id経由で
// sync_draft_to_db.jsがapproved→article_createdへ遷移させる(二重使用防止)。
//
// 使い方: node scripts/seo_topic_candidates_export.js [YYYY-MM-DD]

const fs = require('node:fs');
const path = require('node:path');
const { loadJukuConfig, ROOT } = require('./lib/config');
const seoDb = require('./lib/seo_db');

const MAX_CANDIDATES = 5;
const OUT_DIR = path.join(ROOT, 'data', 'seo_candidates');

function main(dateArg) {
  const date = dateArg || process.argv[2] || new Date().toISOString().slice(0, 10);
  const config = loadJukuConfig();
  const feature = config.features && config.features.competitor_keyword_analysis;

  if (!feature || !feature.enabled || !feature.use_for_topic_selection) {
    console.log('[seo_topic_candidates_export] enabled または use_for_topic_selection が false のため無処理で終了します');
    return;
  }

  // listKeywordCandidates()のstatusは単一値の完全一致のみを受け付けるため、
  // approved/queuedの2状態を別々に取得してから合算する(2026-07-29、queued漏れ修正)。
  const candidates = ['approved', 'queued']
    .flatMap((status) => seoDb.listKeywordCandidates({ status, approvedAction: 'create_article', orderBy: 'priority_score' }))
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, MAX_CANDIDATES);

  if (candidates.length === 0) {
    console.log('[seo_topic_candidates_export] 承認済み/キュー投入済み(新規記事)候補が無いため無処理で終了します');
    return;
  }

  const payload = candidates.map((c) => {
    const existingArticles = seoDb.listCandidateExistingArticles(c.id);
    return {
      candidate_id: c.id,
      normalized_keyword: c.normalized_keyword,
      target_area: c.target_area,
      target_school: c.target_school,
      target_grade: c.target_grade,
      target_subject: c.target_subject,
      gap_type: c.gap_type,
      priority_score: c.priority_score,
      recommended_action: c.recommended_action,
      existing_article:
        existingArticles.length > 0 ? { post_id: existingArticles[0].post_id, title: existingArticles[0].post_title } : null,
    };
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${date}.json`);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`[seo_topic_candidates_export] ${payload.length}件を ${outPath} に出力しました`);
}

if (require.main === module) {
  main();
}

module.exports = { main };
