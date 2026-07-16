'use strict';

// data/drafts/YYYY-MM-DD-{slug}.md (frontmatter付きMarkdown) を読み、
// posts.sqlite に登録/更新する。エージェント自身はテキストファイルの
// 読み書き(Read/Write)のみを行い、DBへの反映はこの決定的なスクリプトが担う。
//
// 使い方: node scripts/sync_draft_to_db.js data/drafts/2026-07-06-slug.md

const fs = require('node:fs');
const path = require('node:path');
const matter = require('gray-matter');
const { marked } = require('marked');
const { insertPost, updatePostBySlug, getPostBySlug } = require('./lib/db');
const { ROOT } = require('./lib/config');
const seoDb = require('./lib/seo_db');
const branchesDb = require('./lib/branches_db');
const { getBranchContext } = require('./lib/branch_context');
const { logError } = require('./log_error');

// パイプライン内部のdraft frontmatter status → DB(posts.sqlite)のstatus対応表。
// 中間状態(written/edited/revision_needed)のドラフトは同期対象外(パイプライン継続中のため)。
const STATUS_MAP = {
  verified: 'review_pending', // 石橋のチェックを通過 → 人間の確認待ち
  escalated: 'rejected',      // 差し戻し上限(2回)に達し人間判断が必要 → 要対応として表示
};

// frontmatterのオブジェクト値をDB保存用のJSON文字列に変換する(既に文字列ならそのまま)
function toJsonTextOrNull(value) {
  if (!value) return null;
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function main() {
  const relOrAbs = process.argv[2];
  if (!relOrAbs) {
    console.error('使い方: node scripts/sync_draft_to_db.js <draftファイルパス>');
    process.exit(1);
  }
  const filePath = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(ROOT, relOrAbs);
  const raw = fs.readFileSync(filePath, 'utf8');
  const { data: fm, content } = matter(raw);

  const required = ['title', 'slug', 'category', 'status'];
  for (const key of required) {
    if (!fm[key]) {
      console.error(`[sync_draft_to_db] frontmatterに ${key} がありません: ${filePath}`);
      process.exit(1);
    }
  }

  const dbStatus = STATUS_MAP[fm.status];
  if (!dbStatus) {
    console.error(
      `[sync_draft_to_db] status="${fm.status}" はまだDB同期できる状態ではありません` +
      `(verified または escalated のみ同期可)。パイプラインが未完了の可能性があります: ${filePath}`
    );
    process.exit(1);
  }

  const bodyMd = content.trim();
  const bodyHtml = marked.parse(bodyMd);

  const existing = getPostBySlug(fm.slug);
  const fields = {
    title: fm.title,
    category: fm.category,
    target_audience: fm.target_audience || null,
    keywords: Array.isArray(fm.keywords) ? fm.keywords.join(',') : (fm.keywords || null),
    meta_description: fm.meta_description || null,
    body_md: bodyMd,
    body_html: bodyHtml,
    fact_check_report: toJsonTextOrNull(fm.fact_check_report),
    status: dbStatus,
    reviewer_note: fm.reviewer_note || (dbStatus === 'rejected' ? '自動エスカレーション: 石橋のチェックで2回差し戻し。要人間確認' : null),
    // 季節テーマ(config/seasonal_topics.yaml)を採用した記事の場合のみ智谷が企画時に設定する。
    // 通常テーマの記事はどちらもnullのまま(公開期限のチェック対象外になる)。
    seasonal_topic_id: fm.seasonal_topic_id || null,
    publish_window_end: fm.publish_window_end || null,
    // scripts/check_similarity.js が設定する過去記事との類似度チェック結果
    similarity_check: toJsonTextOrNull(fm.similarity_check),
    // 智谷が設定する企画採用理由・採点結果
    plan_rationale: toJsonTextOrNull(fm.plan_rationale),
    // 出典情報(episode_sources/parent_qa_sources/web_sourcesは智谷、
    // citation_checkはscripts/check_citations.jsが設定)をまとめて保存する
    citations: toJsonTextOrNull({
      episode_sources: fm.episode_sources || [],
      parent_qa_sources: fm.parent_qa_sources || [],
      web_sources: fm.web_sources || [],
      citation_check: fm.citation_check || null,
      episode_used_text: fm.episode_used_text || null,
      parent_qa_used_text: fm.parent_qa_used_text || null,
      // 愛知県高校入試 情報ソース参照機能: 使用した事実一覧(表示用。ダッシュボードの
      // 「使用した公式情報/参考情報・出典URL一覧」表示に使う。既存citations列に相乗り)
      exam_facts_used: fm.exam_facts_used || [],
    }),
    // 赤羽が生成するアイキャッチメタデータ(実画像生成は未実装)
    eyecatch: toJsonTextOrNull(fm.eyecatch),
    // 愛知県高校入試 情報ソース参照機能(features.aichi_exam_research)。対象外の記事はいずれもnull
    exam_target_year: fm.exam_target_year || null,
    exam_validation_status: (fm.exam_fact_check && fm.exam_fact_check.status) || null,
    exam_validation_warnings: toJsonTextOrNull(fm.exam_fact_check && fm.exam_fact_check.warnings),
  };

  let postId;
  if (existing) {
    updatePostBySlug(fm.slug, fields);
    postId = existing.id;
    console.log(`[sync_draft_to_db] 更新しました: id=${existing.id} slug=${fm.slug} status=${fields.status}`);
  } else {
    // 記事生成パイプラインの複数校舎対応Phase 1: 校舎コンテキスト(JUKU_BRANCH_ID)が
    // 明示されていればそれを使う(daily_blog.shがbranch引数付きで実行された場合)。
    // 未指定時は従来通り現在アクティブな校舎にフォールバックする
    // (CLI/cronの既存挙動を変えないためのデフォルト)。
    const ctx = getBranchContext();
    const branchId = ctx.isLegacy ? (branchesDb.getActiveBranch() || {}).id ?? null : ctx.branchId;
    postId = insertPost({
      created_at: new Date().toISOString(),
      slug: fm.slug,
      branch_id: branchId,
      ...fields,
    });
    console.log(`[sync_draft_to_db] 新規登録しました: id=${postId} slug=${fm.slug} status=${fields.status}`);
  }

  // 競合キーワード分析(Keyword Gap Lite): 智谷がdata/seo_candidates/の候補を採用した場合、
  // 企画(seo_candidate_id)がdraftのfrontmatterまで転記されている。実際に記事が
  // review_pendingとして登録できた(=review_pending到達)タイミングで、その候補を
  // approved→article_createdへ遷移させ、投稿と紐付ける(同じ候補の二重使用を防ぐ)。
  // 候補IDが不正/既に遷移済み等で失敗しても、記事のDB同期自体は成立させる(非致命)。
  if (fm.seo_candidate_id && dbStatus === 'review_pending') {
    try {
      const nowIso = new Date().toISOString();
      seoDb.updateCandidateStatus(fm.seo_candidate_id, { toStatus: 'article_created', reason: '記事生成完了', actor: 'system' }, nowIso);
      seoDb.upsertCandidateExistingArticle(
        { candidate_id: fm.seo_candidate_id, post_id: postId, similarity_score: null, match_reason: 'generated_from_candidate' },
        nowIso
      );
      console.log(`[sync_draft_to_db] 競合キーワード候補(candidate_id=${fm.seo_candidate_id})を article_created に更新しました`);
    } catch (err) {
      logError('sync_draft_to_db_seo_candidate', `candidate_id=${fm.seo_candidate_id}: ${err.message}`);
      console.error(`[sync_draft_to_db] seo_candidate_idの更新に失敗しましたが記事の同期は継続しました: ${err.message}`);
    }
  }

  console.log('[sync_draft_to_db] 完了。data/recent_titles.json 等の更新は scripts/refresh_indexes.js を別途実行してください。');
}

main();
