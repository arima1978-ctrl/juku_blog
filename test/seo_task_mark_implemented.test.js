'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_mark_implemented_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { closeDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');
const { parseArgs, main } = require('../scripts/seo_task_mark_implemented');

after(() => {
  closeDb();
  try {
    fs.unlinkSync(process.env.JUKU_BLOG_DB_PATH);
  } catch {
    // 既に無ければ無視
  }
});

const nowIso = '2026-07-27T00:00:00.000Z';

test('parseArgs: --task-id/--note/--unsetを解釈できる', () => {
  const args = parseArgs(['--task-id=64', '--note=メモ']);
  assert.equal(args.taskId, 64);
  assert.equal(args.note, 'メモ');
  assert.equal(args.unset, false);
});

test('main: --task-id未指定ならexitCode=1', () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  process.argv = ['node', 'seo_task_mark_implemented.js'];
  try {
    main();
    assert.equal(process.exitCode, 1);
  } finally {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
  }
});

test('main: 実行するとimplemented_atがセットされる', () => {
  const task = seoDb.upsertTask(
    { task_type: 'improve_school_page', target_keyword: 'mark テスト', opportunity_score: 70, recommended_action: 'improve_school_page' },
    nowIso
  );

  const originalArgv = process.argv;
  process.argv = ['node', 'seo_task_mark_implemented.js', `--task-id=${task.id}`, '--note=手動で確認済み'];
  try {
    main();
  } finally {
    process.argv = originalArgv;
  }

  const after1 = seoDb.getTaskById(task.id);
  assert.ok(after1.implemented_at);
  assert.equal(after1.implementation_note, '手動で確認済み');
});

test('main --unset: implemented_atをNULLに戻せる', () => {
  const task = seoDb.upsertTask(
    { task_type: 'improve_school_page', target_keyword: 'mark unset テスト', opportunity_score: 70, recommended_action: 'improve_school_page' },
    nowIso
  );
  seoDb.markTaskImplemented(task.id, { implementedAt: nowIso, note: 'x' });

  const originalArgv = process.argv;
  process.argv = ['node', 'seo_task_mark_implemented.js', `--task-id=${task.id}`, '--unset'];
  try {
    main();
  } finally {
    process.argv = originalArgv;
  }

  const after1 = seoDb.getTaskById(task.id);
  assert.equal(after1.implemented_at, null);
  assert.equal(after1.implementation_note, null);
});
