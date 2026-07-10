'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isWithinWindow,
  getActiveTopics,
  findTopicById,
  loadSeasonalTopics,
} = require('../scripts/lib/seasonal_topics');

test('isWithinWindow: 期間内の日付はtrue', () => {
  const topic = { publish_window: { start: '2026-07-11', end: '2026-07-20' } };
  assert.equal(isWithinWindow(topic, '2026-07-11'), true); // 開始日(境界)
  assert.equal(isWithinWindow(topic, '2026-07-15'), true); // 中間
  assert.equal(isWithinWindow(topic, '2026-07-20'), true); // 終了日(境界)
});

test('isWithinWindow: 期間外の日付はfalse', () => {
  const topic = { publish_window: { start: '2026-07-11', end: '2026-07-20' } };
  assert.equal(isWithinWindow(topic, '2026-07-10'), false); // 前日
  assert.equal(isWithinWindow(topic, '2026-07-21'), false); // 翌日
});

test('isWithinWindow: publish_windowが無ければfalse', () => {
  assert.equal(isWithinWindow({}, '2026-07-15'), false);
});

test('getActiveTopics: 優先度の高い順にソートされる', () => {
  const topics = [
    { id: 'low', priority: 10, publish_window: { start: '2026-07-11', end: '2026-07-20' } },
    { id: 'high', priority: 90, publish_window: { start: '2026-07-11', end: '2026-07-20' } },
    { id: 'mid', priority: 50, publish_window: { start: '2026-07-11', end: '2026-07-20' } },
  ];
  const active = getActiveTopics('2026-07-15', topics);
  assert.deepEqual(active.map((t) => t.id), ['high', 'mid', 'low']);
});

test('getActiveTopics: 期間外のテーマは除外される', () => {
  const topics = [
    { id: 'in-window', priority: 10, publish_window: { start: '2026-07-11', end: '2026-07-20' } },
    { id: 'out-of-window', priority: 100, publish_window: { start: '2026-08-01', end: '2026-08-10' } },
  ];
  const active = getActiveTopics('2026-07-15', topics);
  assert.deepEqual(active.map((t) => t.id), ['in-window']);
});

test('findTopicById: 実際のconfig/seasonal_topics.yamlのfallback_topic_idが すべて実在するIDを指している', () => {
  const topics = loadSeasonalTopics();
  const ids = new Set(topics.map((t) => t.id));
  const missing = [];
  for (const t of topics) {
    if (t.fallback_topic_id && !ids.has(t.fallback_topic_id)) {
      missing.push(`${t.id} -> ${t.fallback_topic_id}`);
    }
  }
  assert.deepEqual(missing, [], `存在しないfallback_topic_id参照: ${missing.join(', ')}`);
});

test('実際のconfig/seasonal_topics.yamlが読み込め、5期間・全52テーマが揃っている', () => {
  const topics = loadSeasonalTopics();
  assert.equal(topics.length, 52);
  const windows = new Set(topics.map((t) => `${t.publish_window.start}~${t.publish_window.end}`));
  assert.equal(windows.size, 5);
});

test('実際のconfig/seasonal_topics.yamlのIDに重複がない', () => {
  const topics = loadSeasonalTopics();
  const ids = topics.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});
