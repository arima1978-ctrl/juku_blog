'use strict';

// ダッシュボードの「テーマカレンダー」表示用: 日付ごとの予定テーマを、
// 智谷(planner-blog-btoc)の企画手順1-3と同じ優先順位(季節テーマバンク優先→
// 曜日テーマ+月次季節文脈)で軽量に再現する。同じ期間内で既に使った季節テーマは
// 除外し、1日1テーマずつ消費されていくように見せる(重複回避の簡易再現)。
// あくまで表示・見通し用であり、実際の企画時は過去記事との重複回避・素材の
// 有無等もさらに加味されるため確定ではない。

const { loadCalendarConfig, resolveYamlSource } = require('./config');
const { loadSeasonalTopics, getActiveTopics } = require('./seasonal_topics');
const { WEEKDAY_KEYS } = require('./season');

// UTC基準でYYYY-MM-DD文字列に日数を加算する(ホストのタイムゾーンに依存しない)
function addDaysToDateStr(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function getWeekdayKey(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return WEEKDAY_KEYS[d.getUTCDay()];
}

function getMonthNumber(dateStr) {
  return Number(dateStr.slice(5, 7));
}

// 1日分の予定テーマを計算する。usedTopicIdsに既に含まれる季節テーマは、
// 智谷が実際に行う「過去記事(recent_titles.json)と重複しないものを探す」処理を
// 簡易的に再現するため候補から除外する(同じ期間内で同じテーマが何日も
// 続けて表示されるのを防ぐ)。
function projectThemeForDate(dateStr, { calendarConfig, seasonalTopics, usedTopicIds = new Set() }) {
  const activeSeasonalTopics = getActiveTopics(dateStr, seasonalTopics).filter((t) => !usedTopicIds.has(t.id));
  if (activeSeasonalTopics.length > 0) {
    const top = activeSeasonalTopics[0];
    return {
      date: dateStr,
      source: 'seasonal_topic',
      seasonalTopicId: top.id,
      title: top.title,
      category: top.category,
      priority: top.priority,
      alternativeCount: activeSeasonalTopics.length - 1,
    };
  }

  const weekdayKey = getWeekdayKey(dateStr);
  const weekday = (calendarConfig.weekdays && calendarConfig.weekdays[weekdayKey]) || null;
  const month = getMonthNumber(dateStr);
  const season = (calendarConfig.seasons || []).find((s) => (s.months || []).includes(month)) || null;

  return {
    date: dateStr,
    source: 'weekday',
    weekdayLabel: weekday ? weekday.label : null,
    category: weekday ? weekday.category : null,
    themes: weekday ? weekday.themes || [] : [],
    season: season ? { id: season.id, label: season.label, priorityThemes: season.priority_themes || [] } : null,
  };
}

// startDateStr(YYYY-MM-DD)からdays日分の予定テーマを配列で返す。
// 一度使った季節テーマIDは以降の日で除外し、期間内で1日1テーマずつ消費されていく
// ように見せる(実際の智谷の重複回避ロジックの簡易再現)。
// branchId明示時(ダッシュボードAPI経由)は校舎別calendar.yaml/seasonal_topics.yamlを
// 優先し、無ければ共有ファイルへフォールバックする(その場合isSharedFallback=trueを返す。
// 「あま本部を見ているのに小幡校向けの地域名混じりテーマが出る」混乱を避けるため、
// 呼び出し元がこのフラグを見て参考表示である旨をUIに明示できるようにする)。
function projectThemeCalendar(startDateStr, days, branchId) {
  const calendarConfig = loadCalendarConfig(branchId);
  const seasonalTopics = loadSeasonalTopics(branchId);
  const calendarSource = resolveYamlSource('config/calendar.yaml', branchId);
  const seasonalTopicsSource = resolveYamlSource('config/seasonal_topics.yaml', branchId);
  const isSharedFallback = calendarSource.isSharedFallback || seasonalTopicsSource.isSharedFallback;

  const usedTopicIds = new Set();
  const days_ = [];
  let cursor = startDateStr;
  for (let i = 0; i < days; i++) {
    const day = projectThemeForDate(cursor, { calendarConfig, seasonalTopics, usedTopicIds });
    if (day.source === 'seasonal_topic') usedTopicIds.add(day.seasonalTopicId);
    days_.push(day);
    cursor = addDaysToDateStr(cursor, 1);
  }
  return { days: days_, isSharedFallback };
}

module.exports = {
  addDaysToDateStr,
  getWeekdayKey,
  getMonthNumber,
  projectThemeForDate,
  projectThemeCalendar,
};
