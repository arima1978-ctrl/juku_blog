'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeNextScheduleSlot, isWithinPublishWindow } = require('../scripts/lib/schedule');

test('computeNextScheduleSlot: 予約実績が無い場合は明日になる(当日には公開しない)', () => {
  const now = new Date('2026-07-10T10:00:00Z'); // 2026-07-10 19:00 JST
  const slot = computeNextScheduleSlot(null, '05:00', now);
  assert.equal(slot.dateOnly, '2026-07-11');
  assert.equal(slot.wpDate, '2026-07-11T05:00:00');
});

test('computeNextScheduleSlot: 直近の予約日の翌日になる(まとめ承認で同日集中しない)', () => {
  const now = new Date('2026-07-10T10:00:00Z');
  const latest = '2026-07-10T20:00:00.000Z'; // = 2026-07-11 05:00 JST
  const slot = computeNextScheduleSlot(latest, '05:00', now);
  assert.equal(slot.dateOnly, '2026-07-12');
});

test('computeNextScheduleSlot: 直近予約日が過去でも今日より前にはならない', () => {
  const now = new Date('2026-07-10T10:00:00Z');
  const latest = '2026-06-01T00:00:00.000Z'; // ずっと過去
  const slot = computeNextScheduleSlot(latest, '05:00', now);
  assert.equal(slot.dateOnly, '2026-07-11'); // 今日基準の翌日
});

test('computeNextScheduleSlot: 3件連続で1日1本ずつ割り当てられる', () => {
  const now = new Date('2026-07-10T10:00:00Z');
  const first = computeNextScheduleSlot(null, '05:00', now);
  const second = computeNextScheduleSlot(first.utcIso, '05:00', now);
  const third = computeNextScheduleSlot(second.utcIso, '05:00', now);
  assert.deepEqual(
    [first.dateOnly, second.dateOnly, third.dateOnly],
    ['2026-07-11', '2026-07-12', '2026-07-13']
  );
});

test('isWithinPublishWindow: 期限内はtrue', () => {
  assert.equal(isWithinPublishWindow('2026-07-15', '2026-07-20'), true);
  assert.equal(isWithinPublishWindow('2026-07-20', '2026-07-20'), true); // 境界
});

test('isWithinPublishWindow: 期限超過はfalse', () => {
  assert.equal(isWithinPublishWindow('2026-07-21', '2026-07-20'), false);
});

test('isWithinPublishWindow: 期限指定が無ければ常にtrue(季節テーマ以外の記事)', () => {
  assert.equal(isWithinPublishWindow('2099-01-01', null), true);
  assert.equal(isWithinPublishWindow('2099-01-01', undefined), true);
});
