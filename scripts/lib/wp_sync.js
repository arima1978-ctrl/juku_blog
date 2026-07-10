'use strict';

// WordPress側の投稿ステータスとローカルDBのstatusを突き合わせ、次に何をすべきかを
// 決定する純粋関数。実際のREST API呼び出しはscripts/sync_wordpress_status.jsが行う。
// WordPressを実体の正とする方針: ローカルのstatusを勝手に増やさず、
// 安全に遷移できる scheduled→published のみ自動更新し、それ以外は
// wp_sync_error に記録して人間が気づける状態にするだけに留める。

// localStatus: 現在のローカルDBのstatus('scheduled'等)
// wpResult: { status: 'future'|'publish'|'draft'|'pending'|'trash'|'not_found', httpStatus?: number }
function decideSyncAction(localStatus, wpResult) {
  if (wpResult.status === 'not_found') {
    return {
      newLocalStatus: localStatus,
      syncError: 'WordPress上に記事が見つかりません(削除された可能性があります)',
      needsAlert: true,
    };
  }

  if (wpResult.status === 'trash') {
    return {
      newLocalStatus: localStatus,
      syncError: 'WordPress上でゴミ箱に移動されています',
      needsAlert: true,
    };
  }

  if (wpResult.status === 'publish') {
    return {
      newLocalStatus: localStatus === 'scheduled' ? 'published' : localStatus,
      syncError: null,
      needsAlert: false,
    };
  }

  if (wpResult.status === 'future') {
    return { newLocalStatus: localStatus, syncError: null, needsAlert: false };
  }

  if (wpResult.status === 'draft' || wpResult.status === 'pending') {
    return {
      newLocalStatus: localStatus,
      syncError: `WordPress側のステータスが想定外です(${wpResult.status})。内容を確認してください`,
      needsAlert: true,
    };
  }

  return {
    newLocalStatus: localStatus,
    syncError: `未知のWordPressステータスです: ${wpResult.status}`,
    needsAlert: true,
  };
}

module.exports = { decideSyncAction };
