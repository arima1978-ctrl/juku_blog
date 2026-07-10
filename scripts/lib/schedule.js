'use strict';

// 予約投稿の日付計算・公開可能期間チェック。DBアクセスを含まない純粋関数のみを置き、
// 単体テストしやすくする(api-server.jsから直近の予約日時を渡してもらう形)。

function toJstDay(date) {
  return new Date(date.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// 1日1本ペースを保つため、直近の予約済み/公開済み日時の翌日を次の枠にする。
// latestScheduleDate: 直近の予約済み/公開済み日時(ISO文字列)または null
// runTime: "HH:mm"(JST、config/juku.yamlのgeneration.run_time)
// now: 現在時刻(テスト用に注入可能。省略時はnew Date())
function computeNextScheduleSlot(latestScheduleDate, runTime, now = new Date()) {
  const [hh, mm] = runTime.split(':');
  let baseDay = latestScheduleDate ? toJstDay(new Date(latestScheduleDate)) : toJstDay(now);
  const todayJstDay = toJstDay(now);
  if (baseDay < todayJstDay) baseDay = todayJstDay;

  const nextDay = new Date(`${baseDay}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const nextDayStr = nextDay.toISOString().slice(0, 10);

  return {
    dateOnly: nextDayStr, // YYYY-MM-DD(JST)
    wpDate: `${nextDayStr}T${hh}:${mm}:00`, // WordPressの`date`フィールド用(JSTのwall-clock)
    utcIso: new Date(`${nextDayStr}T${hh}:${mm}:00+09:00`).toISOString(), // ローカルDB保存用(UTC)
  };
}

// scheduledDateOnly(YYYY-MM-DD)がwindowEnd(YYYY-MM-DD)以内かどうか。
// windowEndが無ければ(季節テーマ由来でない記事)制限なしとしてtrue。
function isWithinPublishWindow(scheduledDateOnly, windowEnd) {
  if (!windowEnd) return true;
  return scheduledDateOnly <= windowEnd;
}

// 直近の予約済み/公開済み記事の値(カテゴリー・対象読者等)を新しい日付順(直近が先頭)で受け取り、
// 新しい記事の値を加えるとmaxStreak日を超えて連続してしまうかを判定する。
// ブロックはせず「警告すべきか」を返すだけ(承認自体は止めない設計)。
// recentValues: ["勉強のコツ", "勉強のコツ", ...] (直近が先頭)
function checkStreak(recentValues, newValue, maxStreak) {
  if (!newValue || !maxStreak || maxStreak <= 0) return { warn: false, streak: 0 };

  let streak = 1; // 新しい記事自身の分
  for (const v of recentValues) {
    if (v === newValue) {
      streak++;
    } else {
      break;
    }
  }

  return { warn: streak > maxStreak, streak };
}

module.exports = { computeNextScheduleSlot, isWithinPublishWindow, checkStreak, toJstDay };
