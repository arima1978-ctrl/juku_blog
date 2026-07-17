'use strict';

// Keyword Gap Lite(競合キーワード分析)の複数校舎対応。
// seo_page_analyze.js/seo_gap_calculate.jsが辞書生成に使うconfigは、校舎ごとの
// target_area(branchesテーブル)を反映せずconfig/juku.yamlのarea.city(単一校舎時代の
// 固定値)のまま使われていたため、新規校舎のページ解析で複合キーワードが0件になったり
// 別校舎の地域名が誤って候補化されたりする不具合があった(=辞書のねじれ)。
// このモジュールは、その校舎のtarget_areaをconfig.area.cityへ差し替えた「その場限りの
// configコピー」を作る一点のみを担う。

const branchesDbDefault = require('./branches_db');

// branch_idをSQLite prepared statementへ渡す直前に必ず通す。undefined/null/非整数を
// そのまま bind すると `Provided value cannot be bound to SQLite parameter` のような
// 分かりにくいエラーになるため、原因箇所を特定しやすい形で早期にthrowする。
function normalizeBranchId(branchId) {
  const n = Number(branchId);
  if (branchId === undefined || branchId === null || !Number.isInteger(n)) {
    throw new Error(`branchIdが不正です: ${branchId}`);
  }
  return n;
}

// baseConfigをディープコピーした上で、指定校舎のtarget_areaをarea.cityに適用して返す。
// 元のconfigオブジェクトは一切変更しない(ループ実行時に前の校舎のエリアが残留し、
// 辞書のねじれが再発するため)。target_areaが未設定の校舎はwarnログを出し、
// yamlの既定値(area.city)のままフォールバックする。
function applyBranchArea(baseConfig, branchId, branchesDbImpl = branchesDbDefault) {
  const id = normalizeBranchId(branchId);
  const branch = branchesDbImpl.getBranchById(id);
  if (!branch) {
    throw new Error(`branch_id=${id} に該当する校舎が見つかりません`);
  }

  const config = JSON.parse(JSON.stringify(baseConfig));
  config.area = config.area || {};

  if (branch.target_area) {
    config.area.city = branch.target_area;
  } else {
    console.warn(
      `[branch_area] branch_id=${id}(${branch.name})はtarget_areaが未設定のため、共有config/juku.yamlのarea.city(${config.area.city}) にフォールバックします`
    );
  }

  return { config, branch };
}

module.exports = { normalizeBranchId, applyBranchArea };
