'use strict';

// あま本部校セルフ運用(branches.sync_mode='draft_review'、2026-07-27)。
// 承認済み記事をWordPress予約投稿(publishPost)ではなく下書き(createDraftPost)として
// 同期する専用の経路。api-server.js(手動承認のフォールバック)とsync_draft_to_db.js
// (verified到達時の自動同期)の両方から呼ぶ共通ロジック。

const { createDraftPost } = require('./wordpress');
const { setWordPressDraftSynced } = require('./db');

async function syncPostAsWordPressDraft(post, nowIso) {
  const result = await createDraftPost({
    title: post.title,
    bodyHtml: post.body_html,
    metaDescription: post.meta_description,
    branchId: post.branch_id,
    slug: post.slug,
    keywords: post.keywords,
  });
  setWordPressDraftSynced(post.id, { wpPostId: result.wpPostId, wpLink: result.link, nowIso });
  return result;
}

module.exports = { syncPostAsWordPressDraft };
