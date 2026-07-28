'use strict';

// GSC実績のURL照合用(2026-07-29、週次スナップショットの校舎別ブログ/校舎ページ/その他の
// 4区分分解で使う)。末尾スラッシュ・http/https・wwwの表記揺れを吸収する。
// scripts/lib/seo/url_normalize.js(競合ページの重複排除用。schemeを保持しtracking
// クエリのみ除去する別用途)とは目的が異なるため、あえて別ファイルにしている。
//
// posts.wp_link は予約作成時点(status:future)の "?p=<id>" 形式のまま更新されないため
// (WordPressは実際に公開されて初めて日付ベースのパーマリンク "/YYYY/MM/<id>/" を発行する。
// 2026-07-29に実データで確認済み)、wp_link文字列そのものではなく、GSCのpage URLが
// そのwp_post_idをパスセグメントとして含むかどうかで照合する(パーマリンク構造の
// 日付部分に依存しない、より頑健な方式)。

// スキーム・www・クエリ/フラグメントを取り除き、host+pathへ正規化する(末尾は必ず"/"にする)。
// 不正なURLはnullを返す(呼び出し側は非マッチ扱いにする)。
function normalizeUrl(rawUrl) {
  if (!rawUrl) return null;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  let pathname = url.pathname;
  if (!pathname.endsWith('/')) pathname += '/';
  return `${host}${pathname}`;
}

// 正規化済みURLのパスが、指定した数値ID(WordPress投稿ID)をパスセグメントとして
// 末尾に持つかどうかを判定する(例: "an-english.com/2026/07/14229/" は id=14229 にマッチする)。
function pathEndsWithId(normalizedUrl, id) {
  if (!normalizedUrl || id == null) return false;
  return normalizedUrl.endsWith(`/${id}/`);
}

module.exports = { normalizeUrl, pathEndsWithId };
