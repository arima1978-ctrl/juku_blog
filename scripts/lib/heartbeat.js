'use strict';

// バッチ監視(2026-07-27)。cron実行されるバッチ(daily_blog_all.sh/seo_weekly_analysis.sh/
// backup_db.sh等)が「実行され完了した」ことを記録する軽量な生存確認(デッドマンスイッチ)。
// 各バッチはstep単位の失敗有無に関わらず、スクリプト自体が最後まで走った時点で
// recordHeartbeat()を呼ぶ(cronが起動すらしていない・途中で無応答になった、といった
// 「失敗イベントが発火しようがないケース」を、この生存確認の欠落側から検知するため)。

const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./config');

// テスト時のみ、JUKU_BLOG_HEARTBEATS_DIR で本番と別ディレクトリを使う。
const HEARTBEATS_DIR = process.env.JUKU_BLOG_HEARTBEATS_DIR || path.join(ROOT, 'logs', 'heartbeats');

function heartbeatPath(name) {
  return path.join(HEARTBEATS_DIR, `${name}.json`);
}

function recordHeartbeat(name, { ok, detail, completedAt } = {}) {
  fs.mkdirSync(HEARTBEATS_DIR, { recursive: true });
  const payload = { name, ok: ok !== false, detail: detail || null, completedAt: completedAt || new Date().toISOString() };
  fs.writeFileSync(heartbeatPath(name), JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function readHeartbeat(name) {
  const p = heartbeatPath(name);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

module.exports = { recordHeartbeat, readHeartbeat, HEARTBEATS_DIR };
