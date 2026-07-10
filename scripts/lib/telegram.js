'use strict';

// 承認・自動投稿結果の通知用。TELEGRAM_TOKEN/TELEGRAM_CHAT_ID が未設定の場合は
// 何もせずスキップする(通知は任意機能であり、承認・投稿フロー自体を止めない)。

const https = require('node:https');

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('[telegram] TELEGRAM_TOKEN/TELEGRAM_CHAT_ID 未設定のため通知をスキップしました');
    return;
  }
  try {
    await new Promise((resolve, reject) => {
      const payload = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
      const req = https.request(
        {
          hostname: 'api.telegram.org',
          path: `/bot${token}/sendMessage`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          res.on('data', () => {});
          res.on('end', resolve);
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  } catch (err) {
    console.warn('[telegram] 通知送信に失敗しました:', err.message);
  }
}

module.exports = { sendTelegram };
