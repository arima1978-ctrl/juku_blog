'use strict';

// scripts/build_failure_excerpt.js(2026-08-08)。旧実装の`tail -n 10 | cut -c1-500`は
// 先頭から500文字に切り詰めていたため、Node起動時のExperimentalWarning等のノイズ行が
// 枠を埋め尽くし、本当に必要な末尾のエラー文言(OAuth session expired)が実際のVPSで
// 毎回失われていた(実インシデントの回帰テスト)。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildFailureExcerpt, takeLastChars, isNoiseLine, NOISE_PATTERNS } = require('../scripts/build_failure_excerpt');

// 実際にVPSのlogs/daily_blog_2026-08-08.logで観測された内容を模したログ
// (sync_wordpress_status/refresh_indexesの完了ログ+ExperimentalWarning×2セットが
// researcher-localの実エラーより先に来る、という実際の並び順を再現する)。
const REALISTIC_NOISY_LOG = [
  '[05:30:11] !!! researcher-local が失敗しました',
  '(node:3080812) ExperimentalWarning: SQLite is an experimental feature and might change at any time',
  '(Use `node --trace-warnings ...` to show where the warning was created)',
  '[sync_wordpress_status] 完了: 対象1件、同期1件、警告1件',
  '[refresh_indexes] /home/ubuntu/juku_blog/data/recent_titles.json と /home/ubuntu/juku_blog/data/rejected_notes.json を更新しました',
  '(node:3080824) ExperimentalWarning: SQLite is an experimental feature and might change at any time',
  '(Use `node --trace-warnings ...` to show where the warning was created)',
  '[20:37:39] === researcher-local (agent: researcher-local) ===',
  'Failed to authenticate: OAuth session expired and could not be refreshed',
  '[20:37:45] !!! researcher-local が失敗しました',
].join('\n');

test('buildFailureExcerpt: 実インシデント回帰 - ノイズ行に埋もれても末尾のOAuthエラー文言が残る', () => {
  const excerpt = buildFailureExcerpt(REALISTIC_NOISY_LOG);
  assert.match(excerpt, /Failed to authenticate: OAuth session expired and could not be refreshed/);
});

test('buildFailureExcerpt: 除外されたノイズ行(ExperimentalWarning等)は結果に含まれない', () => {
  const excerpt = buildFailureExcerpt(REALISTIC_NOISY_LOG);
  assert.ok(!excerpt.includes('ExperimentalWarning'));
  assert.ok(!excerpt.includes('--trace-warnings'));
  assert.ok(!excerpt.includes('[sync_wordpress_status]'));
  assert.ok(!excerpt.includes('[refresh_indexes]'));
});

test('buildFailureExcerpt: 旧実装(先頭からcut)だとOAuthエラーが失われることの再現確認', () => {
  // 回帰の前提が正しいことを示すため、あえて旧ロジック(先頭10行のノイズ混じりを
  // 先頭から500文字に切る)を再現し、失敗することを確認しておく。
  const legacyExcerpt = REALISTIC_NOISY_LOG.split('\n').slice(-10).join(' ').slice(0, 500);
  assert.ok(!legacyExcerpt.includes('OAuth session expired'), '旧ロジックでは失われていたはず(前提確認)');
});

test('buildFailureExcerpt: ノイズ除外後に何も残らなければ除外前の末尾を使うフォールバック', () => {
  const allNoiseLog = [
    '(node:1) ExperimentalWarning: SQLite is an experimental feature and might change at any time',
    '(Use `node --trace-warnings ...` to show where the warning was created)',
    '[sync_wordpress_status] 完了: 対象0件、同期0件、警告0件',
    '[refresh_indexes] 更新しました',
  ].join('\n');
  const excerpt = buildFailureExcerpt(allNoiseLog);
  assert.notEqual(excerpt, '');
  assert.match(excerpt, /ExperimentalWarning|sync_wordpress_status/);
});

test('buildFailureExcerpt: 空文字列を渡してもエラーにならず空文字を返す', () => {
  assert.equal(buildFailureExcerpt(''), '');
  assert.equal(buildFailureExcerpt(undefined), '');
});

test('buildFailureExcerpt: 日本語混在ログで文字化けしない(全角文字がそのまま残る)', () => {
  const log = ['前段のノイズ行', '塾長の米澤です。今日は守山区の話をします。', 'エラー本体: 認証に失敗しました(トークン失効)'].join('\n');
  const excerpt = buildFailureExcerpt(log, { maxChars: 30 });
  // 文字単位で切っているため、崩れた文字(replacement character等)が出ないことを確認する。
  assert.ok(!excerpt.includes('�'));
  assert.match(excerpt, /[぀-ヿ一-鿿]/); // ひらがな/カタカナ/漢字が残っている
});

test('takeLastChars: サロゲートペア(絵文字)の途中でちょうど切れる境界でも文字が壊れない', () => {
  // 「あ」×3 + 絵文字(サロゲートペア、UTF-16では2コード単位) + 「い」×3
  const text = 'あああ🚨いいい';
  // maxCharsをサロゲートペアの直前(コードポイント単位で3)に設定し、境界をまたがせる
  const excerpt = takeLastChars(text, 4); // 末尾4コードポイント: 🚨いいい
  assert.equal(excerpt, '🚨いいい');
  assert.ok(!excerpt.includes('�'));
  // Array.from()で正しくコードポイント単位になっていること(壊れたサロゲートが単独で残らない)
  assert.equal(Array.from(excerpt).length, 4);
});

test('takeLastChars: 文字列がmaxChars以下ならそのまま返す', () => {
  assert.equal(takeLastChars('短い文字列', 100), '短い文字列');
});

test('isNoiseLine: 登録済みパターンに一致する行を検出する', () => {
  assert.equal(isNoiseLine('(node:123) ExperimentalWarning: foo', NOISE_PATTERNS), true);
  assert.equal(isNoiseLine('Failed to authenticate: OAuth session expired', NOISE_PATTERNS), false);
});
