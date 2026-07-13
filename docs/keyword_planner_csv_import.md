# キーワードプランナーCSV取込

Googleキーワードプランナーからエクスポートした検索需要データを取り込む
(`seo_keyword_metrics`テーブル)。有料APIは使わない。

## 手順

1. Google広告の「キーワードプランナー」で対象キーワードの検索ボリュームをCSVエクスポートする。
2. サーバー上の任意の場所にファイルを配置する。
3. 取込を実行する:

```bash
node scripts/seo_keyword_metrics_import.js path/to/keyword_planner_export.csv
node scripts/seo_keyword_metrics_import.js path/to/keyword_planner_export.csv --dry-run  # 確認のみ
```

## 対応している列名(日英どちらでも可、列順は自由)

| 内容 | 対応する列名の例 |
|---|---|
| キーワード | `Keyword` / `キーワード` |
| 月間平均検索数 | `Avg. monthly searches` / `月間平均検索ボリューム` / `月間検索数` |
| 競合性 | `Competition` / `競合性` |
| 競合性(指標値) | `Competition (indexed value)` / `競合性(インデックス値)` |
| 入札単価(下限) | `Top of page bid (low range)` / `ページ上部入札単価(低額帯)` |
| 入札単価(上限) | `Top of page bid (high range)` / `ページ上部入札単価(高額帯)` |

- BOM付きUTF-8・カンマ区切りの数値(例: `1,900`)・空欄・`--`はすべて解析できる。
- キーワード列が空の行はエラーとして記録しスキップする(取込全体は止めない)。
- 同じキーワードを複数回取り込んでも重複行にはならず、最新の値でupsertされる。
- 実行結果(対象件数・取込件数・エラー件数)は標準出力と`seo_import_jobs`テーブルに記録される。

## Provider抽象化(将来のGoogle Ads API切替に備えて)

`scripts/lib/seo/keyword_metrics_provider.js`の`KeywordMetricsProvider`基底クラスを
`CsvKeywordMetricsProvider`が実装している。将来Google Ads APIへ切り替える場合は
`GoogleAdsKeywordMetricsProvider`を追加実装すればよく、呼び出し側(`seo_gap_calculate.js`等)の
変更は最小限で済む設計になっている。
