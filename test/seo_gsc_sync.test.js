'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { ROOT } = require('../scripts/lib/config');
const { defaultDateRange } = require('../scripts/seo_gsc_sync');

test('defaultDateRange: 直近3日分(データ遅延考慮)の期間を返す', () => {
  const { start, end } = defaultDateRange();
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const diffDays = Math.round((endDate - startDate) / (24 * 3600 * 1000));
  assert.equal(diffDays, 2); // 3日分(開始日・終了日含む)
  assert.ok(end < new Date().toISOString().slice(0, 10)); // 今日は含まない(前日まで)
});

test('seo_gsc_sync.js: competitor_keyword_analysis.enabled=false(既定)なら無処理で終了する', () => {
  const output = execFileSync('node', [path.join(ROOT, 'scripts', 'seo_gsc_sync.js'), '--dry-run'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.match(output, /無処理で終了/);
});
