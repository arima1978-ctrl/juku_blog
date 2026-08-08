'use strict';

// バッチ監視アラートの文面組み立てロジック(2026-08-08)。check_batch_heartbeats.js(定期
// デッドマンスイッチ)と、daily_blog_all.shが自ら即座に送る失敗通知(scripts/notify_batch_failure.js
// 経由)の両方から共有する。ユーザーが最初に目にするのは後者(06:00頃着信)のため、
// 反復回数・連続日数(🚨)・既知原因の対処法(💡)を同じロジックで両方に載せる。

const { readErrors } = require('../log_error');

// baseTextに加え、referenceIso前後(既定: 前60分〜後5分)にlogs/errors.jsonへ記録された
// 各stepのdetailもまとめて返す(既知原因パターン照合の対象文字列を広げるため)。
// referenceIsoを省略した場合はbaseTextのみを返す(参照時刻が定まらない場合の安全側動作)。
function collectRelatedErrorText(baseText, referenceIso, { beforeMinutes = 60, afterMinutes = 5 } = {}) {
  const parts = [baseText || ''];
  if (referenceIso) {
    const referenceMs = new Date(referenceIso).getTime();
    const windowStartMs = referenceMs - beforeMinutes * 60 * 1000;
    const windowEndMs = referenceMs + afterMinutes * 60 * 1000;
    const relatedErrors = readErrors().filter((e) => {
      const atMs = new Date(e.at).getTime();
      return atMs >= windowStartMs && atMs <= windowEndMs;
    });
    parts.push(...relatedErrors.map((e) => e.detail || ''));
  }
  return parts.join(' ');
}

// incident(recordFailureDetection()の戻り値)とcause(detectKnownCause()の戻り値)を
// 既存の1行メッセージへ追記する。どちらも無ければlineをそのまま返す(後方互換)。
function appendIncidentAndCause(line, { incident, cause } = {}) {
  let result = line;
  if (incident && incident.consecutiveDays > 0) {
    result += `\n🚨 ${incident.consecutiveDays}日連続・通算${incident.detectionCount}回目`;
  }
  if (cause) {
    result += `\n💡 対処: ${cause.remedy}`;
  }
  return result;
}

module.exports = { collectRelatedErrorText, appendIncidentAndCause };
