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
// queuedの優先消化(2026-07-30〜、塾曜日限定): queuedは人間がダッシュボードで明示的に
// 「これを記事化キューへ送った」という意図表明であり、汎用の季節テーマ在庫より優先して
// 智谷の手順0(planner-blog-btoc.md参照)で消化される。そのため queued は上限を設けず
// 全件出力し(approvedと違い人間が指名した少数のはずで、上限で漏れる方が問題)、
// キュー投入順(FIFO)に並べる。approvedは従来通りpriority_score順で、queuedが使った分を
// 差し引いた残り枠まで(合計MAX_CANDIDATES件)。
//
// FIFO順の実装上の既知の限界(2026-07-30): seo_keyword_candidatesにキュー投入日時を
// 専用に保持するカラムが無いため、updated_at(最終ステータス更新日時)を代用している。
// queued中の候補に対して(ステータス変更を伴わない)何らかの更新が別途入ると、その候補の
// updated_atが更新され、見かけ上キューの先頭に来てしまう可能性がある(実際の投入順とズレる)。
// 現状queuedは同時に数件程度の運用のため実害は無いと判断しているが、queuedの運用件数が
// 増えてきたら、seo_candidate_status_history(to_status='queued'のcreated_at)を正とする
// 実装に切り替えることを検討すること。
//
// このファイルは候補のステータスを変更しない(あくまで智谷への提示用)。
// 実際に智谷が採用した候補は、data/plans/YYYY-MM-DD.jsonのseo_candidate_id経由で
// sync_draft_to_db.jsがstatus不問でarticle_createdへ遷移させる(queued/approvedいずれの
// 状態からでも遷移できることを確認済み。二重使用防止)。
//
// 使い方: node scripts/seo_topic_candidates_export.js [YYYY-MM-DD]

const fs = require('node:fs');
const path = require('node:path');
const { loadJukuConfig, ROOT } = require('./lib/config');
const seoDb = require('./lib/seo_db');
const { classifyContentCategory } = require('./lib/seo/content_category');

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

  // queuedは上限を設けず全件、updated_at昇順(DESC取得を反転)でFIFO化する
  // (上のコメント参照。orderBy:'updated_at'はseo_db.js側の共通実装がDESC固定のため、
  // ここでreverse()して古い順=キュー投入順に直す)。
  const queuedCandidates = seoDb
    .listKeywordCandidates({ status: 'queued', approvedAction: 'create_article', orderBy: 'updated_at' })
    .reverse();
  // approvedはqueuedが使った分を差し引いた残り枠まで、priority_score順。
  const approvedCandidates = seoDb
    .listKeywordCandidates({ status: 'approved', approvedAction: 'create_article', orderBy: 'priority_score' })
    .slice(0, Math.max(0, MAX_CANDIDATES - queuedCandidates.length));

  const candidates = [...queuedCandidates, ...approvedCandidates];

  if (candidates.length === 0) {
    console.log('[seo_topic_candidates_export] 承認済み/キュー投入済み(新規記事)候補が無いため無処理で終了します');
    return;
  }

  const payload = candidates.map((c) => {
    const existingArticles = seoDb.listCandidateExistingArticles(c.id);
    return {
      candidate_id: c.id,
      normalized_keyword: c.normalized_keyword,
      // 2026-07-30追加: 智谷がqueued(手順0で優先消化)とapproved(手順4bで受動的に検討)を
      // 判別するために必須のフィールド。
      status: c.status,
      target_area: c.target_area,
      target_school: c.target_school,
      target_grade: c.target_grade,
      target_subject: c.target_subject,
      gap_type: c.gap_type,
      priority_score: c.priority_score,
      recommended_action: c.recommended_action,
      // 習い事の年間バランス構造化(2026-07-29): calendar.yamlのlocked_category曜日で
      // 智谷がnaraigoto候補のみに絞り込めるよう、辞書分類結果(juku/naraigoto/null)を
      // 併記する(既存のcontent_category.jsを再利用。テーブル自体には保存カラムが無いため
      // ここで都度計算する)。
      content_category: classifyContentCategory(c.normalized_keyword),
      existing_article:
        existingArticles.length > 0 ? { post_id: existingArticles[0].post_id, title: existingArticles[0].post_title } : null,
    };
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${date}.json`);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`[seo_topic_candidates_export] ${payload.length}件(うちqueued=${queuedCandidates.length}件)を ${outPath} に出力しました`);
}

if (require.main === module) {
  main();
}

module.exports = { main };
