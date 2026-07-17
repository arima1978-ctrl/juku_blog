'use strict';

// 使い方: node scripts/log_error.js "<ステップ名>" "<エラー内容>"
// logs/errors.json に追記する(ダッシュボードの「エラー」欄が参照する)
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./lib/config');

// テスト時のみ、JUKU_BLOG_ERRORS_PATH で本番のlogs/errors.jsonと別のファイルを使う
// (JUKU_BLOG_DB_PATHと同じ方式)。api-server.jsも同じ環境変数で読み込み先を揃えること。
const ERRORS_PATH = process.env.JUKU_BLOG_ERRORS_PATH || path.join(ROOT, 'logs', 'errors.json');

// branchIdは呼び出し元がその時点で分かっている場合のみ渡す任意引数(省略時はnull=
// 校舎に紐づかない全体エラーとして扱い、どの校舎を表示中でもダッシュボードに表示する)。
// ダッシュボードの「エラー」欄は表示中の校舎のbranch_id、またはbranch_idがnullの
// エラーのみに絞り込むため、他校舎のクロール失敗等が混ざって表示されなくなる。
function logError(step, detail, branchId) {
  let errors = [];
  if (fs.existsSync(ERRORS_PATH)) {
    try {
      errors = JSON.parse(fs.readFileSync(ERRORS_PATH, 'utf8'));
    } catch {
      errors = [];
    }
  }

  errors.unshift({
    at: new Date().toISOString(),
    step,
    detail,
    branch_id: branchId ?? null,
    resolved: false,
  });

  // 直近50件のみ保持
  errors = errors.slice(0, 50);

  fs.mkdirSync(path.dirname(ERRORS_PATH), { recursive: true });
  fs.writeFileSync(ERRORS_PATH, JSON.stringify(errors, null, 2), 'utf8');
  console.error(`[log_error] 記録しました: ${step} - ${detail}`);
}

if (require.main === module) {
  logError(process.argv[2] || 'unknown_step', process.argv[3] || '');
}

module.exports = { logError };
