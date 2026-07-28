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
const { readHeartbeat, recordFirstSeenIfAbsent } = require('./lib/heartbeat');
const { sendTelegram } = require('./lib/telegram');

// name: heartbeatファイル名(record_heartbeat.js呼び出し時の第1引数と一致させる)。
// maxAgeHours: この時間を超えてheartbeatが更新されていなければ遅延とみなす
// (cronの実行時刻に十分な余裕(数時間)を持たせ、実行タイミングのブレで誤検知しないようにする)。
// この値は「初回heartbeat未記録時の猶予期間」としても使う(下記checkBatches参照)。
const MONITORED_BATCHES = [
  { name: 'daily_blog_all', label: '日次記事生成(daily_blog_all.sh、毎朝05:00)', maxAgeHours: 30 },
  { name: 'seo_weekly_analysis', label: '週次SEO分析(seo_weekly_analysis.sh、日曜01:00)', maxAgeHours: 24 * 8 },
  { name: 'backup_db', label: 'DB日次バックアップ(backup_db.sh、毎朝04:45)', maxAgeHours: 30 },
];

function hoursSince(isoString, nowMs) {
  return (nowMs - new Date(isoString).getTime()) / (1000 * 60 * 60);
}

// 監視導入直後の猶予(2026-07-28、実インシデント対応): heartbeatが一度も記録されていない
// バッチについて、「本当に一度も実行されていない」のか「監視対象に加えられたのがそのバッチの
// 実行周期より後だっただけ」かを、firstSeenMap(このバッチ名を初めて観測した時刻)を使って
// 区別する。firstSeenAtからmaxAgeHours以内は'pending_first_run'(警告なし)とし、
// それを過ぎてもheartbeatが無ければ本当に未実行とみなし'never_recorded'で警告する。
// nowMs/firstSeenMapを注入可能にし、テストでは実時刻・実ファイルに依存しないようにする。
function checkBatches(batches = MONITORED_BATCHES, nowMs = Date.now(), firstSeenMap = {}) {
  return batches.map((batch) => {
    const heartbeat = readHeartbeat(batch.name);
    if (!heartbeat) {
      const firstSeenAt = firstSeenMap[batch.name];
      if (!firstSeenAt) {
        return { ...batch, status: 'pending_first_run', ageHours: null, needsFirstSeenRecord: true };
      }
      const graceAgeHours = hoursSince(firstSeenAt, nowMs);
      if (graceAgeHours <= batch.maxAgeHours) {
        return { ...batch, status: 'pending_first_run', ageHours: graceAgeHours };
      }
      return { ...batch, status: 'never_recorded', ageHours: graceAgeHours };
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
    if (p.status === 'never_recorded') return `❌ ${p.label}: 一度も実行記録がありません(監視導入後${p.maxAgeHours}時間の猶予を過ぎています)`;
    if (p.status === 'stale') return `⏰ ${p.label}: 最終完了 ${p.lastCompletedAt}(${p.ageHours.toFixed(1)}時間前、想定${p.maxAgeHours}時間超過)`;
    if (p.status === 'last_run_failed') return `⚠️ ${p.label}: 最終実行(${p.lastCompletedAt})が失敗していました${p.detail ? ` - ${p.detail}` : ''}`;
    return `${p.label}: ${p.status}`;
  });
  return `🚨 バッチ監視アラート\n${lines.join('\n')}`;
}

async function main() {
  const nowIso = new Date().toISOString();
  const firstSeenMap = recordFirstSeenIfAbsent(MONITORED_BATCHES.map((b) => b.name), nowIso);
  const results = checkBatches(MONITORED_BATCHES, Date.now(), firstSeenMap);
  const problems = results.filter((r) => r.status !== 'ok' && r.status !== 'pending_first_run');
  const pending = results.filter((r) => r.status === 'pending_first_run');
  if (pending.length > 0) {
    console.log(`[check_batch_heartbeats] 監視導入の猶予期間中(初回実行待ち): ${pending.map((p) => p.name).join(', ')}`);
  }
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
