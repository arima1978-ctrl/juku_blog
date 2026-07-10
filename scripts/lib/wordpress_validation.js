'use strict';

// WordPress投稿前の事前検証(投稿者ID・カテゴリーID)。
// HTTPアクセスを含まない純粋関数のみを置き、単体テストしやすくする
// (実際のWP REST API呼び出しはwordpress.js側で行い、取得結果をここに渡す)。

// currentUser: GET /wp-json/wp/v2/users/me の結果 { id, name, ... }
// expected: config/juku.yaml の wordpress設定 { author_id, author_display_name, ... }
function validateAuthor(currentUser, expected) {
  if (!expected || !expected.author_id) {
    // 未設定の場合は検証をスキップする(段階的導入のため)
    return { ok: true, skipped: true };
  }
  if (!currentUser || String(currentUser.id) !== String(expected.author_id)) {
    return {
      ok: false,
      reason: `投稿者ID不一致: 期待=${expected.author_id} 実際=${currentUser ? currentUser.id : '取得失敗'}`,
    };
  }
  if (expected.author_display_name && currentUser.name !== expected.author_display_name) {
    return {
      ok: false,
      reason: `投稿者表示名不一致: 期待="${expected.author_display_name}" 実際="${currentUser.name}"`,
    };
  }
  return { ok: true };
}

// category: GET /wp-json/wp/v2/categories/{id} の結果(見つからなければnull)
// expectedCategoryId: config/juku.yaml の wordpress.category_id
function validateCategory(category, expectedCategoryId) {
  if (!expectedCategoryId) {
    return { ok: true, skipped: true };
  }
  if (!category) {
    return {
      ok: false,
      reason: `カテゴリーID ${expectedCategoryId} がWordPress上に見つかりません`,
    };
  }
  return { ok: true };
}

module.exports = { validateAuthor, validateCategory };
