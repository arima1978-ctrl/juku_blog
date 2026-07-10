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

// パイプライン内部のdraft frontmatter status → DB(posts.sqlite)のstatus対応表。
// 中間状態(written/edited/revision_needed)のドラフトは同期対象外(パイプライン継続中のため)。
const STATUS_MAP = {
  verified: 'review_pending', // 石橋のチェックを通過 → 人間の確認待ち
  escalated: 'rejected',      // 差し戻し上限(2回)に達し人間判断が必要 → 要対応として表示
};

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
  const factCheckReport = fm.fact_check_report
    ? (typeof fm.fact_check_report === 'string' ? fm.fact_check_report : JSON.stringify(fm.fact_check_report, null, 2))
    : null;

  const existing = getPostBySlug(fm.slug);
  const fields = {
    title: fm.title,
    category: fm.category,
    target_audience: fm.target_audience || null,
    keywords: Array.isArray(fm.keywords) ? fm.keywords.join(',') : (fm.keywords || null),
    meta_description: fm.meta_description || null,
    body_md: bodyMd,
    body_html: bodyHtml,
    fact_check_report: factCheckReport,
    status: dbStatus,
    reviewer_note: fm.reviewer_note || (dbStatus === 'rejected' ? '自動エスカレーション: 石橋のチェックで2回差し戻し。要人間確認' : null),
    // 季節テーマ(config/seasonal_topics.yaml)を採用した記事の場合のみ智谷が企画時に設定する。
    // 通常テーマの記事はどちらもnullのまま(公開期限のチェック対象外になる)。
    seasonal_topic_id: fm.seasonal_topic_id || null,
    publish_window_end: fm.publish_window_end || null,
    // scripts/check_similarity.js が設定する過去記事との類似度チェック結果
    similarity_check: fm.similarity_check
      ? (typeof fm.similarity_check === 'string' ? fm.similarity_check : JSON.stringify(fm.similarity_check, null, 2))
      : null,
  };

  if (existing) {
    updatePostBySlug(fm.slug, fields);
    console.log(`[sync_draft_to_db] 更新しました: id=${existing.id} slug=${fm.slug} status=${fields.status}`);
  } else {
    const id = insertPost({
      created_at: new Date().toISOString(),
      slug: fm.slug,
      ...fields,
    });
    console.log(`[sync_draft_to_db] 新規登録しました: id=${id} slug=${fm.slug} status=${fields.status}`);
  }

  console.log('[sync_draft_to_db] 完了。data/recent_titles.json 等の更新は scripts/refresh_indexes.js を別途実行してください。');
}

main();
