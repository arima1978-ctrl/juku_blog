'use strict';

const crypto = require('node:crypto');
const {
  getExamResearchCache,
  getLatestExamResearchCache,
  insertExamResearchCache,
  insertExamResearchUpdateEvent,
} = require('../db');

function computeHash(text) {
  return crypto.createHash('sha256').update(text || '').digest('hex');
}

// TTL内の有効なキャッシュがあればそれを返す(nullなら再取得が必要)
function getFresh(sourceUrl, nowIso) {
  return getExamResearchCache(sourceUrl, nowIso);
}

// 新規取得結果を保存し、前回取得分とハッシュが異なれば更新イベントを記録する
// (既存記事の自動書き換えは一切行わない。記録するだけ)。
function saveFetchResult({ sourceId, sourceUrl, parentUrl, contentType, documentTitle, targetYear, fetchedAt, ttlHours, httpStatus, extractedText, rawText, parseStatus, errorMessage }) {
  const previous = getLatestExamResearchCache(sourceUrl);
  const currentHash = computeHash(extractedText);

  if (previous && previous.content_hash && previous.content_hash !== currentHash) {
    insertExamResearchUpdateEvent({
      source_id: sourceId,
      source_url: sourceUrl,
      previous_hash: previous.content_hash,
      current_hash: currentHash,
      target_year: targetYear,
      detected_at: fetchedAt,
    });
  }

  const expiresAt = new Date(new Date(fetchedAt).getTime() + ttlHours * 60 * 60 * 1000).toISOString();

  return insertExamResearchCache({
    source_id: sourceId,
    source_url: sourceUrl,
    parent_url: parentUrl,
    content_type: contentType,
    document_title: documentTitle,
    target_year: targetYear,
    fetched_at: fetchedAt,
    expires_at: expiresAt,
    http_status: httpStatus,
    content_hash: currentHash,
    raw_text: rawText,
    extracted_text: extractedText,
    parse_status: parseStatus,
    error_message: errorMessage,
  });
}

module.exports = { getFresh, saveFetchResult, computeHash };
