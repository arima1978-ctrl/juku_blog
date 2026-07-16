'use strict';

const { loadCalendarConfig } = require('./config');

const WEEKDAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * 当日の日付から「曜日テーマ」と「季節文脈」を判定する。
 * @param {Date} date
 * @param {number} [branchId] 明示指定時は校舎別calendar.yamlを優先する(無ければ共有へフォールバック)
 * @returns {{weekdayKey: string, weekday: object, season: object|null}}
 */
function resolveDailyContext(date = new Date(), branchId) {
  const calendar = loadCalendarConfig(branchId);
  const weekdayKey = WEEKDAY_KEYS[date.getDay()];
  const weekday = calendar.weekdays[weekdayKey];
  const month = date.getMonth() + 1;

  const season = (calendar.seasons || []).find((s) => s.months.includes(month)) || null;

  return { weekdayKey, weekday, season };
}

module.exports = { resolveDailyContext, WEEKDAY_KEYS };
