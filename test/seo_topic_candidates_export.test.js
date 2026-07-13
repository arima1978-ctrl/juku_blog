'use strict';

// features.competitor_keyword_analysis.use_for_topic_selection が既定(false)の間、
// data/seo_candidates/YYYY-MM-DD.jsonを一切作らないことを確認する
// (愛知県高校入試機能のfetch_exam_research.jsと同じ「無処理終了時は出力ファイルも作らない」方針)。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('../scripts/lib/config');

test('seo_topic_candidates_export.js: use_for_topic_selection=false(既定)なら出力ファイルを作らない', () => {
  const date = '2099-02-02'; // 実データと衝突しない日付
  const outPath = path.join(ROOT, 'data', 'seo_candidates', `${date}.json`);
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

  const output = execFileSync('node', [path.join(ROOT, 'scripts', 'seo_topic_candidates_export.js'), date], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  assert.match(output, /無処理で終了/);
  assert.equal(fs.existsSync(outPath), false);
});
