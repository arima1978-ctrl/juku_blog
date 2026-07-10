'use strict';

// WordPressを実体の正として、ローカルDB(status='scheduled'の記事)の状態を
// 実際のWordPress側のstatusと突き合わせる。scheduled→publishedへの自動遷移のみ行い、
// それ以外の想定外の状態(記事消失・ゴミ箱・下書きに戻された等)はwp_sync_errorに
// 記録してTelegramで警告するだけに留める(自動修復はしない)。
//
// 使い方: node scripts/sync_wordpress_status.js
// 毎日1回、daily_blog.shの冒頭(記事生成前)で自動実行される。

const { listPostsNeedingWpSync, applyWpSyncResult } = require('./lib/db');
const { fetchPostStatus } = require('./lib/wordpress');
const { decideSyncAction } = require('./lib/wp_sync');
const { sendTelegram } = require('./lib/telegram');
const { logError } = require('./log_error');

async function main() {
  const posts = listPostsNeedingWpSync();
  const now = new Date().toISOString();

  let syncedCount = 0;
  let alertCount = 0;

  for (const post of posts) {
    let wpResult;
    try {
      wpResult = await fetchPostStatus(post.wp_post_id);
    } catch (err) {
      logError('sync_wordpress_status', `id=${post.id} wp_post_id=${post.wp_post_id}: ${err.message}`);
      applyWpSyncResult(post.id, {
        newStatus: post.status,
        wpStatus: null,
        syncError: `WordPress APIへの問い合わせに失敗しました: ${err.message}`,
        syncedAt: now,
      });
      alertCount++;
      continue;
    }

    const action = decideSyncAction(post.status, wpResult);
    applyWpSyncResult(post.id, {
      newStatus: action.newLocalStatus,
      wpStatus: wpResult.status,
      syncError: action.syncError,
      syncedAt: now,
    });
    syncedCount++;

    if (action.needsAlert) {
      alertCount++;
      await sendTelegram(`⚠️ WordPress状態同期で問題を検知しました\n${post.title}\n${action.syncError}`);
    } else if (action.newLocalStatus === 'published' && post.status !== 'published') {
      console.log(`[sync_wordpress_status] id=${post.id} "${post.title}" が公開されました`);
    }
  }

  console.log(`[sync_wordpress_status] 完了: 対象${posts.length}件、同期${syncedCount}件、警告${alertCount}件`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[sync_wordpress_status] 予期しないエラー:', err);
    process.exit(1);
  });
}

module.exports = { main };
