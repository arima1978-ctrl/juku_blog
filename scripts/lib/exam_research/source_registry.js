'use strict';

const { loadExamSourcesConfig } = require('../config');

function loadEnabledSources(branchId) {
  const config = loadExamSourcesConfig(branchId);
  return (config.sources || []).filter((s) => s.enabled !== false);
}

function loadClassificationKeywords(branchId) {
  const config = loadExamSourcesConfig(branchId);
  return config.classification_keywords || [];
}

// tagsに1つでも一致するソースを、tier昇順(1が最優先)→設定ファイル記載順で返す。
// tagsが空配列の場合は全有効ソースをtier順で返す(用途タグを絞れなかった場合のフォールバック)。
function selectSourcesByTags(sources, tags) {
  const filtered =
    !tags || tags.length === 0
      ? sources
      : sources.filter((s) => (s.tags || []).some((t) => tags.includes(t)));
  return [...filtered].sort((a, b) => a.tier - b.tier);
}

module.exports = { loadEnabledSources, loadClassificationKeywords, selectSourcesByTags };
