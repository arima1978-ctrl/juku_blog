'use strict';

// 検索需要データのProvider抽象化。MVPではCsvKeywordMetricsProviderのみ必須とし、
// 将来Google Ads APIへ切り替えられるようインターフェースを分離する。

const { parseCsvToObjects } = require('./csv_parser');
const { findColumnValue, parseNumber } = require('./csv_column_map');
const { normalizeKeyword } = require('./normalizer');

const KEYWORD_ALIASES = ['keyword', 'キーワード'];
const AVG_SEARCHES_ALIASES = [
  'avg. monthly searches', 'average monthly searches', 'avg monthly searches',
  '月間平均検索ボリューム', '平均月間検索数', '月間検索数',
];
const COMPETITION_ALIASES = ['competition', '競合性'];
const COMPETITION_INDEX_ALIASES = ['competition (indexed value)', 'competition index', '競合性(インデックス値)'];
const LOW_BID_ALIASES = ['top of page bid (low range)', 'ページ上部入札単価(低額帯)', 'ページ上部入札単価(下限)'];
const HIGH_BID_ALIASES = ['top of page bid (high range)', 'ページ上部入札単価(高額帯)', 'ページ上部入札単価(上限)'];

class KeywordMetricsProvider {
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async getKeywordIdeas(params) {
    throw new Error('Not implemented');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async getHistoricalMetrics(params) {
    throw new Error('Not implemented');
  }
}

class CsvKeywordMetricsProvider extends KeywordMetricsProvider {
  // csvText: CSVファイルの内容(文字列)。sourceFile: 取込元ファイル名(記録用)。
  // 戻り値: { rows: [正規化済みレコード], summary: {total, imported, skipped, error} }
  // ("imported"は取込CLI側でupsert件数として扱う想定。ここでは解析結果のみ返す)
  // eslint-disable-next-line class-methods-use-this
  parse(csvText, sourceFile) {
    const { rows } = parseCsvToObjects(csvText);
    const parsed = [];
    const errors = [];

    rows.forEach((row, index) => {
      const keyword = findColumnValue(row, KEYWORD_ALIASES);
      if (!keyword || !keyword.trim()) {
        errors.push({ rowIndex: index, reason: 'キーワード列が空です' });
        return;
      }
      const { normalized } = normalizeKeyword(keyword.trim());
      parsed.push({
        keyword: keyword.trim(),
        normalized_keyword: normalized,
        average_monthly_searches: parseNumber(findColumnValue(row, AVG_SEARCHES_ALIASES)),
        competition: findColumnValue(row, COMPETITION_ALIASES) || null,
        competition_index: parseNumber(findColumnValue(row, COMPETITION_INDEX_ALIASES)),
        low_top_of_page_bid: parseNumber(findColumnValue(row, LOW_BID_ALIASES)),
        high_top_of_page_bid: parseNumber(findColumnValue(row, HIGH_BID_ALIASES)),
        source: 'keyword_planner_csv',
        source_file: sourceFile || null,
      });
    });

    return { rows: parsed, errors, totalRows: rows.length };
  }
}

module.exports = { KeywordMetricsProvider, CsvKeywordMetricsProvider };
