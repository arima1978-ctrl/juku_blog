'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  addDaysToDateStr,
  getWeekdayKey,
  getMonthNumber,
  projectThemeForDate,
  projectThemeCalendar,
} = require('../scripts/lib/theme_calendar');

test('addDaysToDateStr: 日数を正しく加算する(月またぎ)', () => {
  assert.equal(addDaysToDateStr('2026-07-31', 1), '2026-08-01');
  assert.equal(addDaysToDateStr('2026-12-31', 1), '2027-01-01');
});

test('getWeekdayKey: 既知の日付の曜日を正しく判定する', () => {
  // 2026-07-11は土曜日
  assert.equal(getWeekdayKey('2026-07-11'), 'saturday');
  assert.equal(getWeekdayKey('2026-07-12'), 'sunday');
});

test('getMonthNumber: 月を数値で返す', () => {
  assert.equal(getMonthNumber('2026-01-15'), 1);
  assert.equal(getMonthNumber('2026-12-01'), 12);
});

test('projectThemeForDate: 季節テーマバンクの対象期間内はseasonal_topicを優先する', () => {
  const seasonalTopics = [
    { id: 'topic-a', title: 'テーマA', category: '地域情報', priority: 90, publish_window: { start: '2026-07-11', end: '2026-07-20' } },
  ];
  const calendarConfig = { weekdays: { saturday: { label: '土曜テーマ', category: '保護者コラム', themes: ['x'] } }, seasons: [] };
  const result = projectThemeForDate('2026-07-11', { calendarConfig, seasonalTopics });
  assert.equal(result.source, 'seasonal_topic');
  assert.equal(result.seasonalTopicId, 'topic-a');
  assert.equal(result.title, 'テーマA');
});

test('projectThemeForDate: 季節テーマが無い日は曜日テーマにフォールバックする', () => {
  const calendarConfig = {
    weekdays: { saturday: { label: '保護者向けコラム', category: '保護者コラム', themes: ['子どもへの声かけ'] } },
    seasons: [],
  };
  const result = projectThemeForDate('2026-07-11', { calendarConfig, seasonalTopics: [] }); // 土曜日
  assert.equal(result.source, 'weekday');
  assert.equal(result.weekdayLabel, '保護者向けコラム');
  assert.equal(result.category, '保護者コラム');
});

test('projectThemeForDate: 月次季節文脈があれば併記する', () => {
  const calendarConfig = {
    weekdays: { saturday: { label: '保護者向けコラム', category: '保護者コラム', themes: [] } },
    seasons: [{ id: 'natsuyasumi_mae', months: [7], label: '夏休み前', priority_themes: ['夏期講習の活用法'] }],
  };
  const result = projectThemeForDate('2026-07-11', { calendarConfig, seasonalTopics: [] });
  assert.equal(result.season.id, 'natsuyasumi_mae');
});

test('projectThemeForDate: 複数の季節テーマ候補があれば優先度最上位を選び残数を記録する', () => {
  const seasonalTopics = [
    { id: 'low', title: '低優先', category: 'x', priority: 10, publish_window: { start: '2026-07-11', end: '2026-07-20' } },
    { id: 'high', title: '高優先', category: 'x', priority: 90, publish_window: { start: '2026-07-11', end: '2026-07-20' } },
  ];
  const result = projectThemeForDate('2026-07-15', { calendarConfig: { weekdays: {}, seasons: [] }, seasonalTopics });
  assert.equal(result.seasonalTopicId, 'high');
  assert.equal(result.alternativeCount, 1);
});

test('projectThemeCalendar: 同じ期間内で既出の季節テーマは繰り返さず、次の候補に切り替わる', () => {
  const seasonalTopics = [
    { id: 'high', title: '高優先', category: 'x', priority: 90, publish_window: { start: '2026-07-11', end: '2026-07-13' } },
    { id: 'mid', title: '中優先', category: 'x', priority: 50, publish_window: { start: '2026-07-11', end: '2026-07-13' } },
  ];
  // projectThemeCalendarは内部でloadCalendarConfig/loadSeasonalTopicsを使うため、
  // ここではprojectThemeForDateをusedTopicIdsを手動で引き継ぎながら直接呼んで検証する
  const calendarConfig = { weekdays: {}, seasons: [] };
  const usedTopicIds = new Set();
  const day1 = projectThemeForDate('2026-07-11', { calendarConfig, seasonalTopics, usedTopicIds });
  usedTopicIds.add(day1.seasonalTopicId);
  const day2 = projectThemeForDate('2026-07-12', { calendarConfig, seasonalTopics, usedTopicIds });
  usedTopicIds.add(day2.seasonalTopicId);
  const day3 = projectThemeForDate('2026-07-13', { calendarConfig, seasonalTopics, usedTopicIds });

  assert.equal(day1.seasonalTopicId, 'high');
  assert.equal(day2.seasonalTopicId, 'mid'); // highは既出のため次点に切り替わる
  assert.equal(day3.source, 'weekday'); // 候補を使い切ったので曜日テーマにフォールバック
});

test('projectThemeCalendar: 実際のconfig(calendar.yaml/seasonal_topics.yaml)で365日分を生成できる', () => {
  const { days: calendar, isSharedFallback } = projectThemeCalendar('2026-07-11', 365);
  assert.equal(isSharedFallback, false, 'branchId未指定(legacy)ではフォールバック扱いにならない');
  assert.equal(calendar.length, 365);
  assert.equal(calendar[0].date, '2026-07-11');
  assert.equal(calendar[364].date, '2027-07-10');
  // 実データでは7/11-8/31がseasonal_topic、それ以外はweekdayになるはず
  const seasonalCount = calendar.filter((d) => d.source === 'seasonal_topic').length;
  const weekdayCount = calendar.filter((d) => d.source === 'weekday').length;
  assert.equal(seasonalCount + weekdayCount, 365);
  assert.ok(seasonalCount > 0, 'seasonal_topics.yamlの期間中は最低1日以上seasonal_topicになるはず');
  assert.ok(weekdayCount > 0, '大半の期間はweekdayフォールバックになるはず');

  // 実データでの回帰確認: 同じ季節テーマIDが連続する日で繰り返されない
  // (config/seasonal_topics.yamlは1期間に7〜11個の候補があるため)
  const seasonalDays = calendar.filter((d) => d.source === 'seasonal_topic');
  for (let i = 1; i < seasonalDays.length; i++) {
    assert.notEqual(
      seasonalDays[i].seasonalTopicId,
      seasonalDays[i - 1].seasonalTopicId,
      `${seasonalDays[i].date}が前日と同じ季節テーマ(${seasonalDays[i].seasonalTopicId})になっている`
    );
  }
});
