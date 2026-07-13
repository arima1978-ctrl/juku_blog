'use strict';

// GoogleSearchConsoleProviderのユニットテスト。clientFactoryを注入することで、
// 実際のgoogleapisクライアント生成・Google APIへのネットワーク接続は一切行わない。

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SearchConsoleProvider,
  GoogleSearchConsoleProvider,
  toGscQueryRow,
} = require('../scripts/lib/seo/search_console_provider');

test('SearchConsoleProvider: 未実装は例外を投げる', async () => {
  const provider = new SearchConsoleProvider();
  await assert.rejects(() => provider.querySearchAnalytics({}));
});

test('GoogleSearchConsoleProvider: 注入したclientでsearchanalytics.queryを呼び出す(実ネットワーク未使用)', async () => {
  let capturedArgs = null;
  const fakeClient = {
    searchanalytics: {
      query: async (opts) => {
        capturedArgs = opts;
        return { data: { rows: [{ keys: ['守山区 塾', '/school/obata/'], clicks: 3, impressions: 50, ctr: 0.06, position: 4.2 }] } };
      },
    },
  };
  const provider = new GoogleSearchConsoleProvider(async () => fakeClient);
  const result = await provider.querySearchAnalytics({
    siteUrl: 'https://an-english.com/',
    startDate: '2026-07-01',
    endDate: '2026-07-07',
    dimensions: ['query', 'page'],
  });

  assert.equal(capturedArgs.siteUrl, 'https://an-english.com/');
  assert.equal(capturedArgs.requestBody.startDate, '2026-07-01');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].clicks, 3);
});

test('GoogleSearchConsoleProvider: API呼び出し失敗時は例外を投げる(呼び出し元が非致命として処理する)', async () => {
  const failingClient = {
    searchanalytics: { query: async () => { throw new Error('API quota exceeded'); } },
  };
  const provider = new GoogleSearchConsoleProvider(async () => failingClient);
  await assert.rejects(
    () => provider.querySearchAnalytics({ siteUrl: 'https://an-english.com/', startDate: '2026-07-01', endDate: '2026-07-01' }),
    /API quota exceeded/
  );
});

test('toGscQueryRow: dimensions順に関わらずquery/page/device/countryを正しく割り当てる', () => {
  const row = { keys: ['jp', '守山区 塾', 'mobile'], clicks: 1, impressions: 10, ctr: 0.1, position: 5 };
  const result = toGscQueryRow(row, {
    siteProperty: 'https://an-english.com/',
    date: '2026-07-01',
    dimensions: ['country', 'query', 'device'],
    searchType: 'web',
  });
  assert.equal(result.query, '守山区 塾');
  assert.equal(result.device, 'mobile');
  assert.equal(result.country, 'jp');
  assert.equal(result.page, '');
});

test('toGscQueryRow: clicks/impressions等が無ければnullを許容する', () => {
  const result = toGscQueryRow({ keys: ['塾'] }, {
    siteProperty: 'https://an-english.com/',
    date: '2026-07-01',
    dimensions: ['query'],
  });
  assert.equal(result.clicks, null);
  assert.equal(result.impressions, null);
});
