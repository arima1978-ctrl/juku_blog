'use strict';

// 週次スナップショットの対象週計算(2026-07-29)。GSC実績には2〜3日の反映遅延があるため、
// 「今日を含む週」を対象にすると、記録時点でその週の後半3日分のデータが必ず欠けたまま
// 記録される欠陥があった(2026-07-29発覚。seo_weekly_analysis.shが日曜01:00に走り、
// GSC同期は8日前〜3日前しか取得しないため)。常に「先週(7日以上前に終わっている、
// 完全な週)」を対象にすることで、記録時点で必ずGSC実績が反映遅延込みで揃っている
// 状態にする。ローカル暦日(サーバーのタイムゾーン、JST)基準で計算する
// (UTC変換は日付境界付近でずれるため使わない)。

function formatDateLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// nowDate: Dateオブジェクト(省略時は現在時刻。テスト容易性のため注入可能にしている)。
// 戻り値: 'YYYY-MM-DD'形式の、先週(完全に終わっている直近の週)の月曜日。
function getLastCompleteWeekStart(nowDate = new Date()) {
  const isoWeekday = ((nowDate.getDay() + 6) % 7) + 1; // 月曜=1 ... 日曜=7(ローカル日時基準)
  const daysBack = isoWeekday - 1 + 7; // 今週の月曜まで戻り、さらに1週間戻る
  const d = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - daysBack);
  return formatDateLocal(d);
}

// weekStartから6日後(日曜)を返す。seo_metrics_snapshot_generate.jsのweekEndOf()と
// 同じロジック(ローカル暦日ベース、こちらはUTC変換を避けたい呼び出し元向けに用意)。
function weekEndOfLocal(weekStartStr) {
  const [y, m, d] = weekStartStr.split('-').map(Number);
  const end = new Date(y, m - 1, d + 6);
  return formatDateLocal(end);
}

module.exports = { getLastCompleteWeekStart, weekEndOfLocal };
