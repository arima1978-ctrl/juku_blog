'use strict';

// logs/errors.json 解決済みマーク機能(2026-07-29)のテスト。
// 必ず一時ファイル(JUKU_BLOG_ERRORS_PATH)を使い、実データ(logs/errors.json)は一切変更しない。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.JUKU_BLOG_ERRORS_PATH = path.join(os.tmpdir(), `juku_blog_errors_resolve_test_${process.pid}.json`);

const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { ROOT } = require('../scripts/lib/config');
const { readErrors, writeErrors, resolveErrors } = require('../scripts/log_error');
const { buildMatcher, formatList } = require('../scripts/errors_resolve');

after(() => {
  try {
    fs.unlinkSync(process.env.JUKU_BLOG_ERRORS_PATH);
  } catch {
    // 既に無ければ無視
  }
});

function seedErrors() {
  writeErrors([
    { at: '2026-07-17T05:53:39.117Z', step: 'seo_competitor_crawl', detail: 'itto.jp: pre_branch_id', branch_id: 2, resolved: false },
    { at: '2026-07-17T11:36:04.782Z', step: 'wordpress_publish', detail: '投稿者表示名不一致', branch_id: 2, resolved: false },
    { at: '2026-07-27T20:23:05.691Z', step: 'sync_draft_to_db_wp_draft_sync', detail: '.envに設定されていません', branch_id: 2, resolved: false },
  ]);
}

beforeEach(() => {
  seedErrors();
});

test('resolveErrors: matchFnに一致する未解決エラーだけをresolved=trueにする', () => {
  const count = resolveErrors((e) => e.step === 'seo_competitor_crawl', { note: 'pre_branch_id移行完了により解決' });
  assert.equal(count, 1);
  const errors = readErrors();
  const target = errors.find((e) => e.step === 'seo_competitor_crawl');
  assert.equal(target.resolved, true);
  assert.equal(target.resolved_note, 'pre_branch_id移行完了により解決');
  assert.ok(target.resolved_at);
  // 一致しないものは変化しない
  const other = errors.find((e) => e.step === 'wordpress_publish');
  assert.equal(other.resolved, false);
});

test('resolveErrors: 既にresolved=trueの行は再度カウントしない(冪等)', () => {
  resolveErrors((e) => e.step === 'seo_competitor_crawl');
  const count = resolveErrors(() => true); // 全件対象でも、既に解決済みの1件は再カウントしない
  assert.equal(count, 2); // 残り2件のみ
});

test('resolveErrors: 一致する行が無ければ0件・ファイルは書き換えない', () => {
  const before = fs.statSync(process.env.JUKU_BLOG_ERRORS_PATH).mtimeMs;
  const count = resolveErrors((e) => e.step === '__no_such_step__');
  assert.equal(count, 0);
  const after1 = fs.statSync(process.env.JUKU_BLOG_ERRORS_PATH).mtimeMs;
  assert.equal(before, after1);
});

test('buildMatcher: --indexは指定行だけにマッチする', () => {
  const errors = readErrors();
  const matcher = buildMatcher({ index: 1 }, errors);
  assert.equal(matcher(errors[0]), false);
  assert.equal(matcher(errors[1]), true);
});

test('buildMatcher: --beforeは指定日時より前のみマッチする', () => {
  const errors = readErrors();
  const matcher = buildMatcher({ before: '2026-07-20' }, errors);
  assert.equal(matcher(errors[0]), true); // 07-17
  assert.equal(matcher(errors[2]), false); // 07-27
});

test('buildMatcher: --stepと--beforeを組み合わせるとAND条件になる', () => {
  const errors = readErrors();
  const matcher = buildMatcher({ before: '2026-07-20', step: 'wordpress_publish' }, errors);
  assert.equal(matcher(errors[0]), false); // stepが違う
  assert.equal(matcher(errors[1]), true); // stepも日時も一致
});

test('buildMatcher: 何も指定しなければnull(使い方エラーとして扱う)', () => {
  assert.equal(buildMatcher({}, []), null);
});

test('formatList: 未解決のみindex付きで一覧化し、解決済みは含めない', () => {
  resolveErrors((e) => e.step === 'seo_competitor_crawl');
  const errors = readErrors();
  const list = formatList(errors);
  assert.doesNotMatch(list, /pre_branch_id/);
  assert.match(list, /投稿者表示名不一致/);
});

test('CLI: --listはプレビューのみ表示し書き込まない', () => {
  const output = execFileSync('node', [path.join(ROOT, 'scripts', 'errors_resolve.js'), '--list'], { env: process.env }).toString();
  assert.match(output, /投稿者表示名不一致/);
});

test('CLI: --confirm無しはプレビューのみでresolvedを変更しない', () => {
  execFileSync('node', [path.join(ROOT, 'scripts', 'errors_resolve.js'), '--step=wordpress_publish'], { env: process.env });
  const errors = readErrors();
  assert.equal(errors.find((e) => e.step === 'wordpress_publish').resolved, false);
});

test('CLI: --confirmで実際にresolved=trueへ変更する', () => {
  const output = execFileSync(
    'node',
    [path.join(ROOT, 'scripts', 'errors_resolve.js'), '--step=wordpress_publish', '--note=author config finalized', '--confirm'],
    { env: process.env }
  ).toString();
  assert.match(output, /1件を解決済みにしました/);
  const errors = readErrors();
  assert.equal(errors.find((e) => e.step === 'wordpress_publish').resolved, true);
});
