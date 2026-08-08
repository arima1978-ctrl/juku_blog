'use strict';

// daily_blog_all.shが自ら即座に送る失敗通知(06:00頃、リトライも失敗した場合)専用のCLI
// (2026-08-08)。check_batch_heartbeats.jsの次回4時間おきチェックより先にユーザーが最初に
// 目にする通知のため、こちらにも同じ通算検知回数・連続日数(scripts/lib/heartbeat.jsの
// recordFailureDetection)・既知原因の対処法(scripts/lib/known_causes.js)を載せる。
// 文面組み立ては scripts/lib/alert_text.js を check_batch_heartbeats.js と共有する。
//
// 使い方: node scripts/notify_batch_failure.js <batch_name> "<本文>"
const path = require('node:path');
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // .envが無い場合はスキップ
}
const { recordFailureDetection } = require('./lib/heartbeat');
const { detectKnownCause } = require('./lib/known_causes');
const { collectRelatedErrorText, appendIncidentAndCause } = require('./lib/alert_text');
const { sendTelegram } = require('./lib/telegram');

async function main(argv = process.argv.slice(2)) {
  const [batchName, baseText] = argv;
  if (!batchName || !baseText) {
    console.error('使い方: node scripts/notify_batch_failure.js <batch_name> "<本文>"');
    process.exitCode = 1;
    return;
  }
  const nowIso = new Date().toISOString();
  const incident = recordFailureDetection(batchName, nowIso);
  const cause = detectKnownCause(collectRelatedErrorText(baseText, nowIso));
  const text = appendIncidentAndCause(baseText, { incident, cause });
  await sendTelegram(text);
}

if (require.main === module) {
  main();
}

module.exports = { main };
