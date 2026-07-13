# 検索順位CSV取込・手動登録

自社・競合の検索順位データを取り込む(`seo_serp_rankings`テーブル)。
**Google検索結果ページを直接取得するProviderは使わない**(利用規約・ブロックのリスクを避けるため)。
無料MVPではCSV取込または手動登録のみとする。

## CSV取込

順位計測ツール(検索順位チェッカー等)からエクスポートしたCSVを取り込む。

```bash
node scripts/seo_serp_import.js path/to/serp_export.csv
node scripts/seo_serp_import.js path/to/serp_export.csv --dry-run  # 確認のみ
```

対応する列名(日英どちらでも可):

| 内容 | 対応する列名の例 |
|---|---|
| キーワード | `keyword` / `キーワード` |
| ドメイン | `domain` / `ドメイン` |
| 順位 | `position` / `順位` |
| 確認日 | `checked_at` / `確認日` / `取得日` |
| 順位取得URL | `url` / `ranking url` / `ページurl` |
| デバイス | `device` / `デバイス` |
| 検索地域 | `location` / `地域` / `検索地域` |

キーワード列・ドメイン列のいずれかが空の行はエラーとしてスキップする。

## 手動登録(CLI未実装、Provider経由でコードから利用)

1件ずつ手動で確認した順位を登録したい場合は、`scripts/lib/seo/serp_provider.js`の
`ManualSerpProvider`を使う(現時点ではCLIラッパー未実装。将来必要になれば
`seo_serp_manual_add.js`のようなスクリプトを追加する)。

## 禁止事項

- Google検索結果ページのHTMLを直接取得・解析する実装は禁止(`SerpProvider`の実装として
  そのようなProviderを追加しないこと)。
- 将来有料SERP APIを追加する場合は`PaidSerpApiProvider`として`SerpProvider`を実装し、
  既存の`CsvSerpProvider`/`ManualSerpProvider`と並列に使えるようにする。
