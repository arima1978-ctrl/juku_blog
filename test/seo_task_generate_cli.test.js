'use strict';

// 実際のCLIスクリプトを子プロセスで実行する結合テスト。growth_director.enabled=false
// (既定)時の無処理終了経路のみを検証する(愛知県高校入試機能・競合キーワード分析と同じ方針)。
// Task一覧/承認/除外はfeatureフラグに依存しないため、一時DBを使い実際に動作確認する。

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_seo_task_cli_test_${process.pid}.sqlite`);
process.env.JUKU_BLOG_DB_PATH = TMP_DB;

const { execFileSync } = require('node:child_process');
const { ROOT } = require('../scripts/lib/config');
const { closeDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');

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

test('seo_task_generate.js: growth_director.enabled=false(既定)なら無処理で終了する', () => {
  const output = run('seo_task_generate.js', ['--dry-run']);
  assert.match(output, /無処理で終了/);
});

test('seo_tasks_list.js: Taskが無ければその旨を表示する(featureフラグに依存しない)', () => {
  const output = run('seo_tasks_list.js');
  assert.match(output, /Taskはありません/);
});

test('seo_tasks_approve.js → seo_tasks_reject.js: proposed→approved、別Taskはrejectedへ遷移できる', () => {
  const nowIso = '2026-07-13T00:00:00.000Z';
  const created = seoDb.upsertTask(
    { task_type: 'improve_school_page', target_keyword: 'CLI経由テスト候補', opportunity_score: 55, recommended_action: 'improve_school_page' },
    nowIso
  );
  closeDb();

  const approveOutput = run('seo_tasks_approve.js', [String(created.id)]);
  assert.match(approveOutput, /proposed → approved/);

  const created2 = seoDb.upsertTask(
    { task_type: 'add_faq', target_keyword: 'CLI経由除外テスト候補', opportunity_score: 20, recommended_action: 'add_faq' },
    nowIso
  );
  closeDb();
  const rejectOutput = run('seo_tasks_reject.js', [String(created2.id)]);
  assert.match(rejectOutput, /proposed → rejected/);
});

test('既存記事生成パイプライン(daily_blog.sh/seo_topic_candidates_export.js)は無変更である(回帰確認)', () => {
  const dailyBlog = fs.readFileSync(path.join(ROOT, 'scripts', 'daily_blog.sh'), 'utf8');
  assert.ok(!dailyBlog.includes('seo_task_generate'), 'daily_blog.shはgrowth_directorに一切接続していないこと');
  const exportScript = fs.readFileSync(path.join(ROOT, 'scripts', 'seo_topic_candidates_export.js'), 'utf8');
  assert.ok(!exportScript.includes('seo_tasks'), 'seo_topic_candidates_export.jsはseo_tasksに一切依存しないこと');
});
