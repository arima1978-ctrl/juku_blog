'use strict';

// エピソード素材(data/episodes.md)・保護者Q&A(data/parent_qa.md)のID抽出と、
// 記事が引用した出典ID(episode_sources/parent_qa_sources)が実在するかの検証。
// 「存在しない出典IDを生成しない」という制約を、智谷/檜山のLLM判断だけに頼らず
// 決定的に検証できるようにするためのモジュール。

// 各行頭の `- [ ] [EP-001] ...` / `- [x] [QA-002] ...` からIDを抽出する。
// HTML コメント(<!-- 例: ... -->)内の記載例は実在の素材ではないため除外する。
function extractIds(rawText, prefix) {
  const withoutComments = (rawText || '').replace(/<!--[\s\S]*?-->/g, '');
  const regex = new RegExp(`^- \\[[ xX]\\] \\[(${prefix}-\\d+)\\]`, 'gm');
  const ids = [];
  let m;
  while ((m = regex.exec(withoutComments))) {
    ids.push(m[1]);
  }
  return ids;
}

// 既存IDの最大値+1を、ゼロパディング3桁で返す(例: EP-004)。既存が無ければ `${prefix}-001`
function nextId(existingIds, prefix) {
  let max = 0;
  for (const id of existingIds) {
    const n = Number(id.split('-')[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  const next = String(max + 1).padStart(3, '0');
  return `${prefix}-${next}`;
}

// candidate: { episodeSources: string[], parentQaSources: string[] }
// available: { episodeIds: string[], parentQaIds: string[] }
function validateCitations(candidate, available) {
  const episodeIds = new Set(available.episodeIds || []);
  const parentQaIds = new Set(available.parentQaIds || []);

  const invalidEpisodeIds = (candidate.episodeSources || []).filter((id) => !episodeIds.has(id));
  const invalidParentQaIds = (candidate.parentQaSources || []).filter((id) => !parentQaIds.has(id));

  return {
    ok: invalidEpisodeIds.length === 0 && invalidParentQaIds.length === 0,
    invalidEpisodeIds,
    invalidParentQaIds,
  };
}

module.exports = { extractIds, nextId, validateCitations };
