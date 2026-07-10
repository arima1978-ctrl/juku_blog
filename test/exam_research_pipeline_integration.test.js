'use strict';

// 実際のCLIスクリプト(fetch_exam_research.js/check_exam_facts.js)を子プロセスで
// 実行し、ファイル入出力込みで結合動作を確認する。外部ネットワークへは一切アクセスしない
// (fetch_exam_research.jsはfeatureフラグOFF時に即終了する経路のみ検証する)。

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const matter = require('gray-matter');
const { ROOT } = require('../scripts/lib/config');

const DRAFTS_DIR = path.join(ROOT, 'data', 'drafts');
const EXAM_DIR = path.join(ROOT, 'data', 'exam_research');
const createdFiles = [];

after(() => {
  for (const f of createdFiles) {
    try {
      fs.unlinkSync(f);
    } catch {
      // 既に無ければ無視
    }
  }
});

function writeDraft(filename, frontmatter, body) {
  const filePath = path.join(DRAFTS_DIR, filename);
  fs.mkdirSync(DRAFTS_DIR, { recursive: true });
  fs.writeFileSync(filePath, matter.stringify(body, frontmatter), 'utf8');
  createdFiles.push(filePath);
  return filePath;
}

test('fetch_exam_research.js: features.aichi_exam_research.enabled=false(既定)の場合は無処理で終了しraw.jsonを作らない', () => {
  const date = '2099-01-01'; // 実データと衝突しない日付
  const rawPath = path.join(EXAM_DIR, `${date}.raw.json`);
  if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath); // 念のため

  const output = execFileSync('node', [path.join(ROOT, 'scripts', 'fetch_exam_research.js'), date], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  assert.match(output, /無処理で終了/);
  assert.equal(fs.existsSync(rawPath), false);
});

test('check_exam_facts.js: exam_facts_usedが無い記事はnot_applicableになり既存フローに影響しない', () => {
  const filePath = writeDraft('2099-01-01-test-exam-not-applicable.md', {
    title: 'テスト記事',
    slug: 'test-exam-not-applicable',
    category: '勉強のコツ',
    status: 'edited',
  }, '本文');

  execFileSync('node', [path.join(ROOT, 'scripts', 'check_exam_facts.js'), filePath], { cwd: ROOT, encoding: 'utf8' });

  const { data } = matter(fs.readFileSync(filePath, 'utf8'));
  assert.equal(data.exam_fact_check.status, 'not_applicable');
});

test('check_exam_facts.js: 年度不一致の事実があるとblockedになりfrontmatterに記録される', () => {
  const filePath = writeDraft('2099-01-01-test-exam-blocked.md', {
    title: 'テスト記事(年度不一致)',
    slug: 'test-exam-blocked',
    category: '入試情報',
    status: 'edited',
    exam_target_year: 2027,
    exam_facts_used: [
      {
        fact_id: 'fact-001',
        fact_type: 'exam_schedule',
        label: '学力検査日',
        value: '2026年X月X日',
        target_year: 2026, // 記事対象年度(2027)と不一致
        is_official: true,
        source_tier: 1,
        source_url: 'https://www.pref.aichi.jp/soshiki/kotogakko/0000027366.html',
      },
    ],
  }, '本文');

  execFileSync('node', [path.join(ROOT, 'scripts', 'check_exam_facts.js'), filePath], { cwd: ROOT, encoding: 'utf8' });

  const { data } = matter(fs.readFileSync(filePath, 'utf8'));
  assert.equal(data.exam_fact_check.status, 'blocked');
  assert.ok(data.exam_fact_check.errors.some((e) => e.code === 'YEAR_MISMATCH'));
});

test('check_exam_facts.js: 年度・出典が正しい事実はpassedになる', () => {
  const filePath = writeDraft('2099-01-01-test-exam-passed.md', {
    title: 'テスト記事(正常)',
    slug: 'test-exam-passed',
    category: '入試情報',
    status: 'edited',
    exam_target_year: 2027,
    exam_facts_used: [
      {
        fact_id: 'fact-001',
        fact_type: 'exam_schedule',
        label: '学力検査日',
        value: '2027年X月X日',
        target_year: 2027,
        is_official: true,
        source_tier: 1,
        source_url: 'https://www.pref.aichi.jp/soshiki/kotogakko/0000027366.html',
      },
    ],
  }, '本文');

  execFileSync('node', [path.join(ROOT, 'scripts', 'check_exam_facts.js'), filePath], { cwd: ROOT, encoding: 'utf8' });

  const { data } = matter(fs.readFileSync(filePath, 'utf8'));
  assert.equal(data.exam_fact_check.status, 'passed');
});
