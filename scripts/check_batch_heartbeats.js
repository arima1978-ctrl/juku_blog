'use strict';

// デッドマンスイッチ本体(2026-07-27)。cron自体が起動しない・バッチが途中で無応答になる等、
// 「失敗イベント自体が発火しようがない」障害を、期待される時間内にheartbeatが更新されて
// いるかどうかで検知する。監視対象バッチの実行cronとは別枠のcronで、この監視スクリプト
// 自体を定期実行すること(例: 4時間おき)。
//
// 使い方: node scripts/check_batch_heartbeats.js
//   1件でも遅延を検知した場合のみTelegramへ1通(まとめて)送信する。全て正常なら
//   通知は送らない(「バッチ失敗時のみ通知」というユーザー指示に合わせ、正常時は無音)。

const path = require('node:path');
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // .envが無い場合はスキップ
}
const { readHeartbeat } = require('./lib/heartbeat');
const { sendTelegram } = require('./lib/telegram');

// name: heartbeatファイル名(record_heartbeat.js呼び出し時の第1引数と一致させる)。
// maxAgeHours: この時間を超えてheartbeatが更新されていなければ遅延とみなす
// (cronの実行時刻に十分な余裕(数時間)を持たせ、実行タイミングのブレで誤検知しないようにする)。
const MONITORED_BATCHES = [
  { name: 'daily_blog_all', label: '日次記事生成(daily_blog_all.sh、毎朝05:00)', maxAgeHours: 30 },
  { name: 'seo_weekly_analysis', label: '週次SEO分析(seo_weekly_analysis.sh、日曜01:00)', maxAgeHours: 24 * 8 },
  { name: 'backup_db', label: 'DB日次バックアップ(backup_db.sh、毎朝04:45)', maxAgeHours: 30 },
];

function hoursSince(isoString, nowMs) {
  return (nowMs - new Date(isoString).getTime()) / (1000 * 60 * 60);
}

// nowMsを注入可能にし、テストでは実時刻に依存しないようにする。
function checkBatches(batches = MONITORED_BATCHES, nowMs = Date.now()) {
  return batches.map((batch) => {
    const heartbeat = readHeartbeat(batch.name);
    if (!heartbeat) {
      return { ...batch, status: 'never_recorded', ageHours: null };
    }
    const ageHours = hoursSince(heartbeat.completedAt, nowMs);
    if (ageHours > batch.maxAgeHours) {
      return { ...batch, status: 'stale', ageHours, lastCompletedAt: heartbeat.completedAt, lastOk: heartbeat.ok };
    }
    if (heartbeat.ok === false) {
      return { ...batch, status: 'last_run_failed', ageHours, lastCompletedAt: heartbeat.completedAt, detail: heartbeat.detail };
    }
    return { ...batch, status: 'ok', ageHours, lastCompletedAt: heartbeat.completedAt };
  });
}

function formatAlertText(problems) {
  const lines = problems.map((p) => {
    if (p.status === 'never_recorded') return `❌ ${p.label}: 一度も実行記録がありません`;
    if (p.status === 'stale') return `⏰ ${p.label}: 最終完了 ${p.lastCompletedAt}(${p.ageHours.toFixed(1)}時間前、想定${p.maxAgeHours}時間超過)`;
    if (p.status === 'last_run_failed') return `⚠️ ${p.label}: 最終実行(${p.lastCompletedAt})が失敗していました${p.detail ? ` - ${p.detail}` : ''}`;
    return `${p.label}: ${p.status}`;
  });
  return `🚨 バッチ監視アラート\n${lines.join('\n')}`;
}

async function main() {
  const results = checkBatches();
  const problems = results.filter((r) => r.status !== 'ok');
  if (problems.length === 0) {
    console.log('[check_batch_heartbeats] 全バッチ正常です');
    return;
  }
  const text = formatAlertText(problems);
  console.log(`[check_batch_heartbeats] ${problems.length}件の異常を検知しました:\n${text}`);
  await sendTelegram(text);
}

if (require.main === module) {
  main();
}

module.exports = { MONITORED_BATCHES, checkBatches, formatAlertText, main };
