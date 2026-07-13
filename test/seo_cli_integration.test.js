'use strict';

// 実際のCLIスクリプトを子プロセスで実行する結合テスト。外部ネットワークへは一切
// アクセスしない(競合クロール/解析/Gap計算はfeatureフラグOFF時の無処理終了経路のみ検証。
// これは愛知県高校入試機能のexam_research_pipeline_integration.test.jsと同じ方針)。
// 候補一覧/承認/除外/キュー投入は一時DBを使い実際に動作確認する
// (JUKU_BLOG_DB_PATHをファイル先頭で設定し、子プロセスにも継承させることで
// 本番data/posts.sqliteに一切触れないようにする)。

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_seo_cli_test_${process.pid}.sqlite`);
process.env.JUKU_BLOG_DB_PATH = TMP_DB;

const { execFileSync } = require('node:child_process');
const { ROOT } = require('../scripts/lib/config');
const seoDb = require('../scripts/lib/seo_db');
const { closeDb } = require('../scripts/lib/db');

after(() => {
  closeDb();
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    // 既に無ければ無視
  }
});

function run(script, args = []) {
  return execFileSync('node', [path.join(ROOT, 'scripts', script), ...args], { cwd: ROOT, encoding: 'utf8', env: process.env });
}

test('seo_competitor_crawl.js: competitor_keyword_analysis.enabled=false(既定)なら無処理で終了する', () => {
  const output = run('seo_competitor_crawl.js', ['--dry-run']);
  assert.match(output, /無処理で終了/);
});

test('seo_page_analyze.js: competitor_keyword_analysis.enabled=false(既定)なら無処理で終了する', () => {
  const output = run('seo_page_analyze.js', ['--dry-run']);
  assert.match(output, /無処理で終了/);
});

test('seo_gap_calculate.js: competitor_keyword_analysis.enabled=false(既定)なら無処理で終了する', () => {
  const output = run('seo_gap_calculate.js', ['--dry-run']);
  assert.match(output, /無処理で終了/);
});

test('seo_candidates_list.js: 候補が無ければその旨を表示する(featureフラグに依存しない)', () => {
  const output = run('seo_candidates_list.js');
  assert.match(output, /候補はありません/);
});

test('seo_candidates_approve.js → seo_candidates_queue.js: approved経由でqueuedへ遷移でき、二重キューはエラーになる', () => {
  const nowIso = '2026-07-13T00:00:00.000Z';
  const created = seoDb.upsertKeywordCandidate({ normalized_keyword: 'テスト用候補', gap_type: 'missing', priority_score: 80 }, nowIso);
  closeDb(); // Windowsでの子プロセスからの同時アクセスに備え、親プロセス側の接続は一旦閉じる

  const approveOutput = run('seo_candidates_approve.js', [String(created.id), '手動テスト承認']);
  assert.match(approveOutput, /discovered → approved/);

  const queueOutput = run('seo_candidates_queue.js', [String(created.id)]);
  assert.match(queueOutput, /approved → queued/);

  assert.throws(() => run('seo_candidates_queue.js', [String(created.id)]));
});

test('seo_candidates_reject.js: 候補を除外できる', () => {
  const nowIso = '2026-07-13T00:00:00.000Z';
  const created = seoDb.upsertKeywordCandidate({ normalized_keyword: 'テスト用除外候補', gap_type: 'missing', priority_score: 40 }, nowIso);
  closeDb();

  const output = run('seo_candidates_reject.js', [String(created.id), '対象外地域のため']);
  assert.match(output, /discovered → rejected/);
});
