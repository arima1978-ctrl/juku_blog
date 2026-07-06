'use strict';

// 使い方: node scripts/log_error.js "<ステップ名>" "<エラー内容>"
// logs/errors.json に追記する(ダッシュボードの「エラー」欄が参照する)
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./lib/config');

const ERRORS_PATH = path.join(ROOT, 'logs', 'errors.json');

function main() {
  const step = process.argv[2] || 'unknown_step';
  const detail = process.argv[3] || '';

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
    resolved: false,
  });

  // 直近50件のみ保持
  errors = errors.slice(0, 50);

  fs.mkdirSync(path.dirname(ERRORS_PATH), { recursive: true });
  fs.writeFileSync(ERRORS_PATH, JSON.stringify(errors, null, 2), 'utf8');
  console.error(`[log_error] 記録しました: ${step} - ${detail}`);
}

main();
