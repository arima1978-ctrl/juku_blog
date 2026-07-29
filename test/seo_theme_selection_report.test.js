'use strict';

// テーマ選定レポート(2026-07-29)のテスト。data/plans/実データには一切触れず、
// 一時ディレクトリへ書いたfixtureのみを対象にする(DB非依存の読み取り専用CLI)。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveDateRange, classifySelection, readPlan, buildReport, formatText } = require('../scripts/seo_theme_selection_report');

test('resolveDateRange: sinceとuntilで日付配列を組み立てる', () => {
  assert.deepEqual(resolveDateRange({ since: '2026-07-29', until: '2026-08-01' }), ['2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01']);
});

test('resolveDateRange: daysのみ指定した場合はuntil(既定=今日)からdays日分を遡る', () => {
  const result = resolveDateRange({ until: '2026-08-01', days: 3 });
  assert.deepEqual(result, ['2026-07-30', '2026-07-31', '2026-08-01']);
});

test('classifySelection: seo_candidate_idがあればseo_candidate扱い(seasonal_topic_idより優先)', () => {
  assert.deepEqual(classifySelection({ seo_candidate_id: 17, seasonal_topic_id: 'x' }), { source: 'seo_candidate', id: 17 });
});

test('classifySelection: seasonal_topic_idのみあればseasonal_topic扱い', () => {
  assert.deepEqual(classifySelection({ seo_candidate_id: null, seasonal_topic_id: 'naraigoto-eikaiwa-local' }), {
    source: 'seasonal_topic',
    id: 'naraigoto-eikaiwa-local',
  });
});

test('classifySelection: どちらも無ければweekday_theme扱い', () => {
  assert.deepEqual(classifySelection({ seo_candidate_id: null, seasonal_topic_id: null }), { source: 'weekday_theme', id: null });
});

test('readPlan: ファイルが無ければfound=false', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'juku_blog_theme_report_'));
  const result = readPlan('2026-07-29', tmpDir);
  assert.equal(result.found, false);
});

test('readPlan/buildReport: fixtureファイルから選定内容を組み立てる', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'juku_blog_theme_report_'));
  fs.writeFileSync(
    path.join(tmpDir, '2026-07-29.json'),
    JSON.stringify({
      seasonal_topic_id: 'naraigoto-eikaiwa-local',
      seo_candidate_id: null,
      category: '習い事紹介',
      title_candidates: ['守山区で子ども英会話教室を探すなら'],
      selection_score: 80,
    })
  );
  fs.writeFileSync(
    path.join(tmpDir, '2026-07-30.json'),
    JSON.stringify({
      seasonal_topic_id: null,
      seo_candidate_id: 17,
      category: '勉強のコツ',
      title_candidates: ['自立学習のすすめ'],
      selection_score: 75,
    })
  );

  const rows = buildReport({ since: '2026-07-29', until: '2026-07-31', plansDir: tmpDir });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].found, true);
  assert.deepEqual(rows[0].selection, { source: 'seasonal_topic', id: 'naraigoto-eikaiwa-local' });
  assert.equal(rows[1].selection.source, 'seo_candidate');
  assert.equal(rows[1].selection.id, 17);
  assert.equal(rows[2].found, false); // 2026-07-31はfixture無し

  const text = formatText(rows);
  assert.match(text, /naraigoto-eikaiwa-local/);
  assert.match(text, /候補ID=17/);
  assert.match(text, /計画ファイルなし/);
});
