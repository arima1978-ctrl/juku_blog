'use strict';

// 検索順位データのProvider抽象化。無料MVPではCSV取込・手動登録のみとし、
// Google検索結果ページを直接取得するProviderは禁止する(将来の有料SERP API接続用に
// インターフェースのみ用意する)。

const { parseCsvToObjects } = require('./csv_parser');
const { findColumnValue, parseNumber } = require('./csv_column_map');
const { normalizeKeyword } = require('./normalizer');

const KEYWORD_ALIASES = ['keyword', 'キーワード'];
const DOMAIN_ALIASES = ['domain', 'ドメイン'];
const URL_ALIASES = ['url', 'ranking url', '順位取得url', 'ページurl'];
const POSITION_ALIASES = ['position', '順位'];
const CHECKED_AT_ALIASES = ['checked_at', 'checked at', '確認日', '取得日'];
const DEVICE_ALIASES = ['device', 'デバイス'];
const LOCATION_ALIASES = ['location', '地域', '検索地域'];

class SerpProvider {
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async fetchResults(params) {
    throw new Error('Not implemented');
  }
}

class CsvSerpProvider extends SerpProvider {
  // eslint-disable-next-line class-methods-use-this
  parse(csvText, sourceFile) {
    const { rows } = parseCsvToObjects(csvText);
    const parsed = [];
    const errors = [];

    rows.forEach((row, index) => {
      const keyword = findColumnValue(row, KEYWORD_ALIASES);
      const domain = findColumnValue(row, DOMAIN_ALIASES);
      if (!keyword || !keyword.trim() || !domain || !domain.trim()) {
        errors.push({ rowIndex: index, reason: 'キーワードまたはドメイン列が空です' });
        return;
      }
      const { normalized } = normalizeKeyword(keyword.trim());
      parsed.push({
        keyword: keyword.trim(),
        normalized_keyword: normalized,
        domain: domain.trim(),
        ranking_url: findColumnValue(row, URL_ALIASES) || null,
        position: parseNumber(findColumnValue(row, POSITION_ALIASES)),
        checked_at: findColumnValue(row, CHECKED_AT_ALIASES) || null,
        device: findColumnValue(row, DEVICE_ALIASES) || null,
        location: findColumnValue(row, LOCATION_ALIASES) || null,
        source: 'serp_csv',
        source_file: sourceFile || null,
      });
    });

    return { rows: parsed, errors, totalRows: rows.length };
  }
}

// 手動登録(CLI/ダッシュボードから1件ずつ入力する場合の正規化)。
class ManualSerpProvider extends SerpProvider {
  // eslint-disable-next-line class-methods-use-this
  normalize(entry) {
    const { normalized } = normalizeKeyword(entry.keyword.trim());
    return {
      keyword: entry.keyword.trim(),
      normalized_keyword: normalized,
      domain: entry.domain.trim(),
      ranking_url: entry.ranking_url || null,
      position: entry.position != null ? Number(entry.position) : null,
      checked_at: entry.checked_at,
      device: entry.device || null,
      location: entry.location || null,
      source: 'manual',
    };
  }
}

module.exports = { SerpProvider, CsvSerpProvider, ManualSerpProvider };
