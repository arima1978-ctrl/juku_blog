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

test('実際のconfig/seasonal_topics.yamlが読み込め、12期間・全62テーマが揃っている', () => {
  const topics = loadSeasonalTopics();
  // 2026-07-20: 承認済み記事が公開可能期限超過で投稿保留になったインシデントを受け、
  // junior-high-summer-study-hours/starting-juku-in-summer/summer-study-planの3件を
  // 2026-07-11~07-20から2026-07-11~07-31へ延長したため、期間数が5→6になった。
  // 2026-07-29: 習い事テーマ5件(そろばん/英会話/習字/プログラミング/将棋)を追加し、
  // 52→57テーマ・6→11期間になった。
  // 2026-07-29(追加): 記事ファースト転換に伴い、英会話・習字の通年ローカル記事2件
  // (naraigoto-eikaiwa-local/naraigoto-shodo-local、同一window)を追加し、
  // 57→59テーマ・11→12期間になった。
  // 2026-07-29(習い事の年間バランス構造化): 残り3ジャンル(そろばん/プログラミング/将棋)の
  // 通年ローカル記事3件を、既存2件と同一windowで追加し、59→62テーマ(期間数は同一windowの
  // ため12のまま)になった。
  assert.equal(topics.length, 62);
  const windows = new Set(topics.map((t) => `${t.publish_window.start}~${t.publish_window.end}`));
  assert.equal(windows.size, 12);
});

test('実際のconfig/seasonal_topics.yamlのIDに重複がない', () => {
  const topics = loadSeasonalTopics();
  const ids = topics.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});
