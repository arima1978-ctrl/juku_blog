'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_exam_cache_test_${process.pid}.sqlite`);
process.env.JUKU_BLOG_DB_PATH = TMP_DB;

const { getFresh, saveFetchResult } = require('../scripts/lib/exam_research/cache');
const { closeDb, getDb } = require('../scripts/lib/db');

after(() => {
  closeDb();
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    // 既に無ければ無視
  }
});

test('getFresh: TTL内のキャッシュは有効として返す', () => {
  const fetchedAt = '2026-07-10T00:00:00.000Z';
  saveFetchResult({
    sourceId: 'test-source',
    sourceUrl: 'https://example.com/test-fresh',
    contentType: 'html',
    documentTitle: 'テスト',
    targetYear: 2027,
    fetchedAt,
    ttlHours: 168,
    httpStatus: 200,
    extractedText: '本文テキスト',
    rawText: '本文テキスト',
    parseStatus: 'ok',
    errorMessage: null,
  });

  const nowIso = '2026-07-11T00:00:00.000Z'; // 1日後(168時間以内)
  const cached = getFresh('https://example.com/test-fresh', nowIso);
  assert.ok(cached);
  assert.equal(cached.extracted_text, '本文テキスト');
});

test('getFresh: TTL切れのキャッシュはnullを返す', () => {
  const fetchedAt = '2026-07-01T00:00:00.000Z';
  saveFetchResult({
    sourceId: 'test-source',
    sourceUrl: 'https://example.com/test-expired',
    contentType: 'html',
    documentTitle: 'テスト',
    targetYear: 2027,
    fetchedAt,
    ttlHours: 24, // 24時間
    httpStatus: 200,
    extractedText: '本文',
    rawText: '本文',
    parseStatus: 'ok',
    errorMessage: null,
  });

  const nowIso = '2026-07-10T00:00:00.000Z'; // 9日後、TTL(24h)を大幅に超過
  const cached = getFresh('https://example.com/test-expired', nowIso);
  assert.equal(cached, null);
});

test('saveFetchResult: 前回と本文ハッシュが異なれば更新イベントを記録する', () => {
  const sourceUrl = 'https://example.com/test-update-detect';
  saveFetchResult({
    sourceId: 'test-source',
    sourceUrl,
    contentType: 'html',
    documentTitle: 'テスト',
    targetYear: 2027,
    fetchedAt: '2026-07-01T00:00:00.000Z',
    ttlHours: 1,
    httpStatus: 200,
    extractedText: '旧バージョンの本文',
    rawText: '旧バージョンの本文',
    parseStatus: 'ok',
    errorMessage: null,
  });
  saveFetchResult({
    sourceId: 'test-source',
    sourceUrl,
    contentType: 'html',
    documentTitle: 'テスト',
    targetYear: 2027,
    fetchedAt: '2026-07-02T00:00:00.000Z',
    ttlHours: 1,
    httpStatus: 200,
    extractedText: '新バージョンの本文(更新あり)',
    rawText: '新バージョンの本文(更新あり)',
    parseStatus: 'ok',
    errorMessage: null,
  });

  const conn = getDb();
  const events = conn.prepare('SELECT * FROM exam_research_updates WHERE source_url = ?').all(sourceUrl);
  assert.equal(events.length, 1);
  assert.notEqual(events[0].previous_hash, events[0].current_hash);
});
