'use strict';

// Google Search Console連携。自社サイトの実際の検索実績(クエリ・表示回数・クリック数・
// 掲載順位)を取得する。認証情報はサービスアカウント方式を採用する(.envに秘密鍵を
// 保存する既存の運用方針(WP_APP_PASSWORD等)と一貫させるため。詳細はフェーズ1報告書の
// 「Search Console連携方式」を参照)。
//
// 認証情報を絶対にログへ出力しないこと。テスト時はclientFactoryを注入し、
// 実際のGoogle APIには一切接続しない(このモジュール自体のユニットテストでは
// googleapisの実クライアントを生成しない)。

const { google } = require('googleapis');

class SearchConsoleProvider {
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async querySearchAnalytics(params) {
    throw new Error('Not implemented');
  }
}

// clientFactory: () => Promise<{ searchanalytics: { query: (opts) => Promise<{data}> } }>
// 省略時は環境変数(GSC_CLIENT_EMAIL/GSC_PRIVATE_KEY)からサービスアカウント認証する
// googleapisクライアントを生成する。
function defaultClientFactory() {
  const clientEmail = process.env.GSC_CLIENT_EMAIL;
  const privateKey = process.env.GSC_PRIVATE_KEY;
  if (!clientEmail || !privateKey) {
    throw new Error('GSC_CLIENT_EMAIL/GSC_PRIVATE_KEY が設定されていません(.env参照)');
  }
  const auth = new google.auth.JWT({
    email: clientEmail,
    // .envではエスケープされた\nで保存されることが多いため復元する
    key: privateKey.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });
  return google.searchconsole({ version: 'v1', auth });
}

class GoogleSearchConsoleProvider extends SearchConsoleProvider {
  constructor(clientFactory = defaultClientFactory) {
    super();
    this.clientFactory = clientFactory;
    this.client = null;
  }

  async getClient() {
    if (!this.client) this.client = await this.clientFactory();
    return this.client;
  }

  // params: { siteUrl, startDate, endDate, dimensions, rowLimit, startRow }
  // 戻り値: 生のAPIレスポンス行({keys, clicks, impressions, ctr, position})の配列。
  // API失敗時は例外を投げる(呼び出し元のCLIが非致命として扱い、記事生成へ影響させない)。
  async querySearchAnalytics(params) {
    const client = await this.getClient();
    const dimensions = params.dimensions || ['query', 'page', 'device', 'country'];
    const response = await client.searchanalytics.query({
      siteUrl: params.siteUrl,
      requestBody: {
        startDate: params.startDate,
        endDate: params.endDate,
        dimensions,
        rowLimit: params.rowLimit || 1000,
        startRow: params.startRow || 0,
        searchType: params.searchType || 'web',
      },
    });
    return { rows: response.data.rows || [], dimensions };
  }
}

// Search Console APIの1行(keys配列は指定したdimensions順)を、
// seo_db.upsertGscQueryRowが期待する形へ変換する。
function toGscQueryRow(row, { siteProperty, date, dimensions, searchType }) {
  const dimIndex = (name) => dimensions.indexOf(name);
  const keys = row.keys || [];
  return {
    site_property: siteProperty,
    date,
    query: dimIndex('query') >= 0 ? keys[dimIndex('query')] : '',
    page: dimIndex('page') >= 0 ? keys[dimIndex('page')] : '',
    device: dimIndex('device') >= 0 ? keys[dimIndex('device')] : '',
    country: dimIndex('country') >= 0 ? keys[dimIndex('country')] : '',
    search_type: searchType || 'web',
    clicks: row.clicks ?? null,
    impressions: row.impressions ?? null,
    ctr: row.ctr ?? null,
    position: row.position ?? null,
  };
}

module.exports = { SearchConsoleProvider, GoogleSearchConsoleProvider, toGscQueryRow };
