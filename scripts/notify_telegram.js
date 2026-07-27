'use strict';

// シェルスクリプトからTelegram通知を送るための薄いCLIラッパー。
// TELEGRAM_TOKEN/TELEGRAM_CHAT_ID未設定時は既存のsendTelegram()と同様に無処理でスキップする。
// 使い方: node scripts/notify_telegram.js "通知本文"
const path = require('node:path');
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // .envが無い場合はスキップ
}
const { sendTelegram } = require('./lib/telegram');

async function main() {
  const text = process.argv[2];
  if (!text) {
    console.error('使い方: node scripts/notify_telegram.js "通知本文"');
    process.exitCode = 1;
    return;
  }
  await sendTelegram(text);
}

if (require.main === module) {
  main();
}

module.exports = { main };
