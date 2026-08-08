'use strict';

// 重複Telegram通知の抑制(2026-07-28)。実インシデント: daily_blog_all.shがlegacy/あま本部校の
// 順にdaily_blog.shを2回呼ぶため、sync_wordpress_status.jsの「ゴミ箱移動を検知」アラートが
// 同一記事について1日に2回(05:00頃・05:11頃)送られてしまっていた。
// sendTelegram()自体はネットワーク送信を伴うため(このリポジトリの既存方針どおり実送信は
// テストしない)、抑制ロジックの中核であるisDuplicate/recordSentを直接検証する。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.JUKU_BLOG_TELEGRAM_DEDUPE_PATH = path.join(os.tmpdir(), `juku_blog_telegram_dedupe_test_${process.pid}.json`);
process.env.JUKU_BLOG_ERRORS_PATH = path.join(os.tmpdir(), `juku_blog_telegram_dedupe_errors_test_${process.pid}.json`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { isDuplicate, recordSent, evaluateTelegramResponse, DEFAULT_DEDUPE_WINDOW_MINUTES } = require('../scripts/lib/telegram');
const { readErrors } = require('../scripts/log_error');

after(() => {
  try {
    fs.unlinkSync(process.env.JUKU_BLOG_TELEGRAM_DEDUPE_PATH);
  } catch {
    // 既に無ければ無視
  }
  try {
    fs.unlinkSync(process.env.JUKU_BLOG_ERRORS_PATH);
  } catch {
    // 既に無ければ無視
  }
});

const NOW = new Date('2026-07-28T05:11:00.000Z').getTime();

test('isDuplicate: 一度も送信していない内容はfalse', () => {
  assert.equal(isDuplicate('初めてのメッセージ', DEFAULT_DEDUPE_WINDOW_MINUTES, NOW), false);
});

test('isDuplicate: ウィンドウ内に同一内容を送信済みならtrue(実インシデント: 05:00→05:11の再送を抑制)', () => {
  const text = '⚠️ WordPress状態同期で問題を検知しました\n【守山区中学生保護者向け】夏休み前に見直す学習状況チェック\nWordPress上でゴミ箱に移動されています';
  recordSent(text, '2026-07-28T05:00:00.000Z');
  const elevenMinutesLater = new Date('2026-07-28T05:11:00.000Z').getTime();
  assert.equal(isDuplicate(text, 90, elevenMinutesLater), true);
});

test('isDuplicate: ウィンドウを過ぎていればfalse(翌日以降の再発生は別送信として扱う)', () => {
  const text = '同じ内容のメッセージ';
  recordSent(text, '2026-07-27T05:00:00.000Z');
  const nextDay = new Date('2026-07-28T05:00:01.000Z').getTime(); // 24時間+1秒後
  assert.equal(isDuplicate(text, 90, nextDay), false);
});

test('isDuplicate: 内容が違えば別キー扱いで抑制されない', () => {
  recordSent('記事Aについての警告', '2026-07-28T05:00:00.000Z');
  assert.equal(isDuplicate('記事Bについての警告', 90, NOW), false);
});

test('isDuplicate: dedupeWindowMinutes=0なら常にfalse(抑制を無効化できる)', () => {
  const text = '抑制無効化テスト';
  recordSent(text, '2026-07-28T05:10:59.000Z');
  assert.equal(isDuplicate(text, 0, NOW), false);
});
