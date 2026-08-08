'use strict';

// デッドマンスイッチ本体(2026-07-27)。cron自体が起動しない・バッチが途中で無応答になる等、
// 「失敗イベント自体が発火しようがない」障害を、期待される時間内にheartbeatが更新されて
// いるかどうかで検知する。監視対象バッチの実行cronとは別枠のcronで、この監視スクリプト
// 自体を定期実行すること(例: 4時間おき)。
//
// 使い方: node scripts/check_batch_heartbeats.js [--morning-summary]
//   1件でも遅延を検知した場合のみTelegramへ1通(まとめて)送信する。全て正常なら
//   通知は送らない(「バッチ失敗時のみ通知」というユーザー指示に合わせ、正常時は無音)。
//   --morning-summary: 深夜帯の抑制を無視して必ず送信する朝のまとめ通知モード
//   (毎朝07:35の実行を想定。月曜07:30の週次ダイジェスト<seo_metrics_digest.js>と5分
//   ずらしているのは、同時刻だと片方の通知がもう片方に埋もれるレビュー指摘への対応
//   <2026-08-08>。cronは別途 `35 7 * * *` に追加する)。
//
// 反復アラートの抑制と朝のまとめ通知(2026-08-08、8/7・8/8のclaude CLI OAuth失効
// インシデント再発防止)。同一障害が4時間おきに検知される間、深夜帯(22:00〜06:00 JST)は
// 初回検知を除いて実送信を抑制し、翌朝07:35(--morning-summary)に「未解決のままX時間経過」
// を必ず1本だけ通知する。あわせて通算検知回数・連続検知日数(scripts/lib/heartbeat.js の
// recordFailureDetection)と、既知原因パターンの対処法(scripts/lib/known_causes.js)を
// 文面へ埋め込む。

const path = require('node:path');
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // .envが無い場合はスキップ
}
const { readHeartbeat, recordFirstSeenIfAbsent, readIncident, recordFailureDetection, clearIncident } = require('./lib/heartbeat');
const { sendTelegram } = require('./lib/telegram');
const { detectKnownCause } = require('./lib/known_causes');
const { collectRelatedErrorText, appendIncidentAndCause } = require('./lib/alert_text');

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

// JST(UTC+9)で22:00〜06:00(翌日)を深夜帯とする。サーバのTZ設定に依存させないため、
// UTCに9時間を足した上でUTC基準のgetterで時刻を取り出す。
function isQuietHours(nowMs = Date.now()) {
  const jstHour = new Date(nowMs + 9 * 60 * 60 * 1000).getUTCHours();
  return jstHour >= 22 || jstHour < 6;
}

// 深夜帯は初回検知(isFirstDetection)以外の実送信を抑制し、朝のまとめ通知
// (isMorningSummary、--morning-summaryで実行された回)は常に送信する。
function shouldSendNow({ isFirstDetection, isMorningSummary, nowMs = Date.now() }) {
  if (isMorningSummary) return true;
  if (isFirstDetection) return true;
  return !isQuietHours(nowMs);
}

// last_run_failedの実際のエラー文言(claude CLIの生出力等)からパターン検出するため、
// heartbeat自体のdetailに加え、同じ実行時間帯(完了時刻の前後)にlogs/errors.jsonへ
// 記録された各stepのdetailも合わせて照合する(daily_blog.shのrun_agent()が末尾抜粋を
// 埋め込むよう2026-08-08に変更済み)。実体はscripts/lib/alert_text.jsのcollectRelatedErrorText
// (notify_batch_failure.jsと共有)。
function collectDiagnosticText(problem) {
  return collectRelatedErrorText(problem.detail, problem.lastCompletedAt);
}

function formatProblemBaseLine(problem) {
  if (problem.status === 'never_recorded') return `❌ ${problem.label}: 一度も実行記録がありません(監視導入後${problem.maxAgeHours}時間の猶予を過ぎています)`;
  if (problem.status === 'stale') return `⏰ ${problem.label}: 最終完了 ${problem.lastCompletedAt}(${problem.ageHours.toFixed(1)}時間前、想定${problem.maxAgeHours}時間超過)`;
  if (problem.status === 'last_run_failed') return `⚠️ ${problem.label}: 最終実行(${problem.lastCompletedAt})が失敗していました${problem.detail ? ` - ${problem.detail}` : ''}`;
  return `${problem.label}: ${problem.status}`;
}

// contextはproblem.name→{incident, cause}のマップ(省略時は従来通り反復回数・対処法無し)。
function formatAlertText(problems, context = {}) {
  const lines = problems.map((p) => appendIncidentAndCause(formatProblemBaseLine(p), context[p.name]));
  return `🚨 バッチ監視アラート\n${lines.join('\n')}`;
}

// 朝のまとめ通知(2026-08-08〜)専用の文面。「最終実行が失敗していました」ではなく
// 「未解決のままX時間経過」という表現にし、深夜帯に抑制されていた間も含めて
// 障害が継続していることを明示する。
function formatMorningSummaryText(problems, context = {}) {
  const lines = problems.map((p) => {
    const base = `⚠️ ${p.label}: 未解決のまま${p.ageHours.toFixed(1)}時間経過`;
    return appendIncidentAndCause(base, context[p.name]);
  });
  return `🌅 朝のまとめ通知(未解決のバッチ障害があります)\n${lines.join('\n')}`;
}

// 正常化したバッチのインシデントをクリアし(反復回数・連続日数のカウンタをリセット)、
// 問題ありのバッチについては通算検知回数・連続日数・既知原因の対処法を積み上げて返す。
// clearIncident()が実際にこの経路で呼ばれ、次に失敗した際にdetectionCountが1から
// 再開することは test/check_batch_heartbeats.test.js の
// 「trackIncidents: 復旧でインシデントがクリアされ、再failでdetectionCountが1から再開する」
// で回帰確認している(2026-08-08、レビュー指摘対応)。
function trackIncidents(results, nowIso) {
  results.filter((r) => r.status === 'ok').forEach((r) => clearIncident(r.name));

  const problems = results.filter((r) => r.status !== 'ok' && r.status !== 'pending_first_run');
  const context = {};
  for (const problem of problems) {
    const isFirstDetection = !readIncident(problem.name);
    const incident = recordFailureDetection(problem.name, nowIso);
    const cause = problem.status === 'last_run_failed' ? detectKnownCause(collectDiagnosticText(problem)) : null;
    context[problem.name] = { incident, cause, isFirstDetection };
  }
  return { problems, context };
}

async function main(rawArgv = process.argv.slice(2)) {
  const isMorningSummary = rawArgv.includes('--morning-summary');
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const firstSeenMap = recordFirstSeenIfAbsent(MONITORED_BATCHES.map((b) => b.name), nowIso);
  const results = checkBatches(MONITORED_BATCHES, nowMs, firstSeenMap);
  const pending = results.filter((r) => r.status === 'pending_first_run');
  if (pending.length > 0) {
    console.log(`[check_batch_heartbeats] 監視導入の猶予期間中(初回実行待ち): ${pending.map((p) => p.name).join(', ')}`);
  }

  const { problems, context } = trackIncidents(results, nowIso);
  if (problems.length === 0) {
    console.log('[check_batch_heartbeats] 全バッチ正常です');
    return;
  }

  const toSend = problems.filter((problem) => {
    const { isFirstDetection, incident } = context[problem.name];
    const send = shouldSendNow({ isFirstDetection, isMorningSummary, nowMs });
    if (!send) {
      console.log(`[check_batch_heartbeats] ${problem.name}: 深夜帯のため送信を抑制しました(通算${incident.detectionCount}回目、朝のまとめ通知で送信予定)`);
    }
    return send;
  });

  if (toSend.length === 0) {
    console.log('[check_batch_heartbeats] 深夜帯のため今回の送信はありません(朝のまとめ通知で送信されます)');
    return;
  }

  const text = isMorningSummary ? formatMorningSummaryText(toSend, context) : formatAlertText(toSend, context);
  console.log(`[check_batch_heartbeats] ${toSend.length}件の異常を検知しました:\n${text}`);
  await sendTelegram(text);
}

if (require.main === module) {
  main();
}

module.exports = {
  MONITORED_BATCHES,
  checkBatches,
  trackIncidents,
  formatAlertText,
  formatMorningSummaryText,
  isQuietHours,
  shouldSendNow,
  collectDiagnosticText,
  main,
};
