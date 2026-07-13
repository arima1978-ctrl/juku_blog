'use strict';

// Search Console実績ベースのカニバリゼーション検知。同一クエリで複数の自社ページに
// 表示回数(impressions>0)があれば、同じ検索クエリを複数ページが奪い合っている
// 可能性が高いとみなし警告を生成する。
// (これはコンテンツ類似度ベースのカニバリ検知(seo_candidate_existing_articles)とは
// 別軸の、実際の検索結果表示ベースの検知)

// gscRows: 同一クエリのseo_gsc_queries行の配列([{page, impressions}, ...])
// 戻り値: 複数ページで表示があれば{ pages: [{page, impressions}, ...] }、無ければnull
function detectCannibalization(gscRows) {
  const impressionsByPage = new Map();
  for (const row of gscRows || []) {
    if (!row.page || !(row.impressions > 0)) continue;
    impressionsByPage.set(row.page, (impressionsByPage.get(row.page) || 0) + row.impressions);
  }
  if (impressionsByPage.size <= 1) return null;
  return {
    pages: Array.from(impressionsByPage.entries())
      .map(([page, impressions]) => ({ page, impressions }))
      .sort((a, b) => b.impressions - a.impressions),
  };
}

module.exports = { detectCannibalization };
