'use strict';

// 承認・自動投稿結果の通知用。TELEGRAM_TOKEN/TELEGRAM_CHAT_ID が未設定の場合は
// 何もせずスキップする(通知は任意機能であり、承認・投稿フロー自体を止めない)。
//
// 重複通知の抑制(2026-07-28追加): daily_blog_all.shがlegacy/あま本部校の順に
// daily_blog.shを2回呼ぶため、sync_wordpress_status.jsのようにブランチを問わず全件を
// 見るチェックは1日の中で複数回走り、同じ問題(例: WordPress上でゴミ箱に移動された記事)を
// 毎回検知して同一内容のTelegram通知を短時間に複数回送ってしまう実インシデントがあった。
// 送信テキストのハッシュを直近送信キャッシュ(logs/telegram_recent_sends.json)に記録し、
// 既定90分以内に同一内容を送ろうとした場合はスキップする(翌日以降の再発生は
// 別の送信として扱われるよう、ウィンドウは短めに設定する)。

const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ROOT } = require('./config');

// テスト時のみ、JUKU_BLOG_TELEGRAM_DEDUPE_PATH で本番と別ファイルを使う。
const DEDUPE_PATH = process.env.JUKU_BLOG_TELEGRAM_DEDUPE_PATH || path.join(ROOT, 'logs', 'telegram_recent_sends.json');
const DEFAULT_DEDUPE_WINDOW_MINUTES = 90;
const MAX_CACHE_ENTRIES = 200; // ファイル肥大化を防ぐための上限(古い順に切り詰める)

function readDedupeCache() {
  if (!fs.existsSync(DEDUPE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(DEDUPE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeDedupeCache(cache) {
  const entries = Object.entries(cache).sort((a, b) => new Date(b[1]).getTime() - new Date(a[1]).getTime());
  const trimmed = Object.fromEntries(entries.slice(0, MAX_CACHE_ENTRIES));
  fs.mkdirSync(path.dirname(DEDUPE_PATH), { recursive: true });
  fs.writeFileSync(DEDUPE_PATH, JSON.stringify(trimmed, null, 2), 'utf8');
}

function textKey(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// nowMsを注入可能にし、テストでは実時刻に依存しないようにする。
function isDuplicate(text, windowMinutes, nowMs = Date.now()) {
  if (!windowMinutes) return false;
  const cache = readDedupeCache();
  const lastSentAt = cache[textKey(text)];
  if (!lastSentAt) return false;
  return nowMs - new Date(lastSentAt).getTime() < windowMinutes * 60 * 1000;
}

function recordSent(text, nowIso = new Date().toISOString()) {
  const cache = readDedupeCache();
  cache[textKey(text)] = nowIso;
  writeDedupeCache(cache);
}

// dedupeWindowMinutes: 0を渡すと重複抑制を無効化できる(既定は90分)。
async function sendTelegram(text, { dedupeWindowMinutes = DEFAULT_DEDUPE_WINDOW_MINUTES } = {}) {
  const token = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('[telegram] TELEGRAM_TOKEN/TELEGRAM_CHAT_ID 未設定のため通知をスキップしました');
    return;
  }
  if (isDuplicate(text, dedupeWindowMinutes)) {
    console.log(`[telegram] 直近${dedupeWindowMinutes}分以内に同一内容を送信済みのため重複通知をスキップしました`);
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
    recordSent(text);
  } catch (err) {
    console.warn('[telegram] 通知送信に失敗しました:', err.message);
  }
}

module.exports = { sendTelegram, isDuplicate, recordSent, DEFAULT_DEDUPE_WINDOW_MINUTES };
