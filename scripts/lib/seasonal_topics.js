'use strict';

// config/seasonal_topics.yaml(日付範囲を持つ季節テーマ候補バンク)の読み込み・
// 「当日が公開可能期間内かどうか」の判定を行う。
// このモジュール単体では企画への統合は行わない(智谷への統合は別段階)。

const { loadYaml } = require('./config');

const FILE_PATH = 'config/seasonal_topics.yaml';

function loadSeasonalTopics(branchId) {
  const parsed = loadYaml(FILE_PATH, branchId);
  return (parsed && parsed.seasonal_topics) || [];
}

// dateStr(YYYY-MM-DD)がテーマのpublish_window内にあるか
function isWithinWindow(topic, dateStr) {
  const { start, end } = topic.publish_window || {};
  if (!start || !end) return false;
  return dateStr >= start && dateStr <= end;
}

// 当日(JSTのYYYY-MM-DD)が公開可能期間内のテーマを、優先度の高い順に返す
function getActiveTopics(dateStr, topics = loadSeasonalTopics()) {
  return topics
    .filter((t) => isWithinWindow(t, dateStr))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

function findTopicById(id, topics = loadSeasonalTopics()) {
  return topics.find((t) => t.id === id) || null;
}

module.exports = { loadSeasonalTopics, isWithinWindow, getActiveTopics, findTopicById };
