'use strict';

// scripts/seo_draft_verify.js のCLI結合テスト。DB・WordPress・LLM・外部通信への
// 依存が一切無いことも確認する。

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ROOT } = require('../scripts/lib/config');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'juku_blog_seo_draft_verify_test_'));

after(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

function writeJson(name, obj) {
  const filePath = path.join(TMP_DIR, name);
  fs.writeFileSync(filePath, JSON.stringify(obj), 'utf8');
  return filePath;
}

function run(args, { expectNonZeroExit = false } = {}) {
  try {
    const output = execFileSync('node', [path.join(ROOT, 'scripts', 'seo_draft_verify.js'), ...args], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    if (expectNonZeroExit) throw new Error('非ゼロ終了を期待したが正常終了した');
    return { output, exitCode: 0 };
  } catch (err) {
    if (!expectNonZeroExit) throw err;
    return { output: (err.stdout || '') + (err.stderr || ''), exitCode: err.status };
  }
}

test('正常ファイル: validなJSONはexit 0で結果を表示する', () => {
  const filePath = writeJson('valid.json', {
    can_generate: true,
    summary: '要約',
    suggested_location: '末尾',
    generated_text: '本文',
    change_reason: '理由',
    search_intent_alignment: '一致',
    warnings: [],
  });
  const { output, exitCode } = run([`--input=${filePath}`]);
  assert.equal(exitCode, 0);
  assert.match(output, /valid: true/);
});

test('不正JSON: JSONとして解析できないファイルはexit 1', () => {
  const filePath = path.join(TMP_DIR, 'broken.json');
  fs.writeFileSync(filePath, '{ this is not valid json', 'utf8');
  const { output, exitCode } = run([`--input=${filePath}`], { expectNonZeroExit: true });
  assert.equal(exitCode, 1);
  assert.match(output, /解析できません/);
});

test('input未指定: 使い方を表示してexit 1', () => {
  const { output, exitCode } = run([], { expectNonZeroExit: true });
  assert.equal(exitCode, 1);
  assert.match(output, /使い方/);
});

test('存在しないファイル: エラーメッセージを表示してexit 1', () => {
  const { output, exitCode } = run([`--input=${path.join(TMP_DIR, 'does-not-exist.json')}`], { expectNonZeroExit: true });
  assert.equal(exitCode, 1);
  assert.match(output, /見つかりません/);
});

test('invalidな応答(必須フィールド欠落等)はexit 1', () => {
  const filePath = writeJson('invalid.json', { can_generate: true, generated_text: '' });
  const { output, exitCode } = run([`--input=${filePath}`], { expectNonZeroExit: true });
  assert.equal(exitCode, 1);
  assert.match(output, /valid: false/);
});

test('--format=json: 有効なJSONを出力する', () => {
  const filePath = writeJson('valid2.json', {
    can_generate: false,
    missing_context: ['本文未取得'],
    required_checks: [],
    warnings: [],
  });
  const { output } = run([`--input=${filePath}`, '--format=json']);
  const parsed = JSON.parse(output); // 例外が出なければ有効なJSON
  assert.equal(parsed.valid, true);
});

test('--output指定時はファイルへ出力し、入力ファイルは変更しない', () => {
  const inputPath = writeJson('valid3.json', {
    can_generate: true, summary: 's', suggested_location: 'l', generated_text: 'g', change_reason: 'c', search_intent_alignment: 'a', warnings: [],
  });
  const beforeContent = fs.readFileSync(inputPath, 'utf8');
  const outputPath = path.join(TMP_DIR, 'result.validation.json');
  run([`--input=${inputPath}`, `--output=${outputPath}`]);
  assert.ok(fs.existsSync(outputPath));
  assert.equal(fs.readFileSync(inputPath, 'utf8'), beforeContent); // 入力ファイル不変
});

test('DB非更新・外部通信なし・WordPress/LLM非実行: 対象ファイルにそれらの参照が無い', () => {
  const content = fs.readFileSync(path.join(ROOT, 'scripts', 'seo_draft_verify.js'), 'utf8');
  assert.ok(!/require\(['"]\.\/lib\/db['"]\)/.test(content), 'db.jsを参照していないこと');
  assert.ok(!/require\(['"]\.\/lib\/seo_db['"]\)/.test(content), 'seo_db.jsを参照していないこと');
  assert.ok(!/wp-json/.test(content));
  assert.ok(!/require\(['"]node:https['"]\)/.test(content));
  assert.ok(!/fetch\(/.test(content));
  assert.ok(!/openai|anthropic|generativeai/i.test(content));
});
