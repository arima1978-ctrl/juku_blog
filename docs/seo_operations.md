# 競合キーワード分析: 運用手順

## cron設定

`daily_blog.sh`(毎朝の記事生成)とは完全に分離する。

```cron
# 週次: 競合サイト取得・解析・Gap判定(日曜3時の例)
0 3 * * 0 cd /path/to/juku_blog && ./scripts/seo_weekly_analysis.sh >> logs/seo_weekly_cron.log 2>&1

# 日次: Search Console実績取得(features.*.search_console_enabled有効時のみ動作。毎朝6時の例)
0 6 * * * cd /path/to/juku_blog && node scripts/seo_gsc_sync.js >> logs/seo_gsc_sync_cron.log 2>&1
```

いずれも対象featureフラグが`false`の間は即座に無処理で終了するため、フラグを立てるまでは
cronに登録しても実質何も起きない。

## 手動実行

```bash
node scripts/seo_competitor_crawl.js --dry-run           # 取得内容の確認のみ(DB/ファイル未変更)
node scripts/seo_competitor_crawl.js                     # 競合サイト取得
node scripts/seo_competitor_crawl.js --competitor=<id>    # 特定競合のみ

node scripts/seo_page_analyze.js --dry-run
node scripts/seo_page_analyze.js                         # キーワード候補抽出

node scripts/seo_gap_calculate.js --dry-run
node scripts/seo_gap_calculate.js                         # Gap判定+優先度スコア算出

node scripts/seo_keyword_metrics_import.js <csv> [--dry-run]
node scripts/seo_serp_import.js <csv> [--dry-run]
node scripts/seo_gsc_sync.js [--start=YYYY-MM-DD --end=YYYY-MM-DD] [--dry-run]

node scripts/seo_candidates_list.js [--status=discovered] [--gap-type=missing] [--min-score=70]
node scripts/seo_candidates_approve.js <candidate_id> ["理由"]
node scripts/seo_candidates_reject.js <candidate_id> ["理由"]
node scripts/seo_candidates_queue.js <candidate_id>       # approved→queued(記事生成キューへ)

bash scripts/seo_weekly_analysis.sh                       # crawl→analyze→gap_calculateを一括実行
```

## 有効化する際の推奨手順

1. `config/seo_competitors.yaml`に競合を1社だけ登録し、`crawl_enabled: true`にする。
2. `config/juku.yaml`で`enabled: true`, `crawl_enabled: true`にする(`use_for_topic_selection`は
   まだ`false`のままにしておく)。
3. `node scripts/seo_competitor_crawl.js --dry-run`で取得対象URLとタイトルを確認する。
4. 問題なければ`--dry-run`無しで実行し、`node scripts/seo_page_analyze.js`→
   `node scripts/seo_gap_calculate.js`を実行する。
5. ダッシュボードの「競合キーワード分析」タブで候補を確認する。スコア・gap_typeの
   妥当性を見て、必要なら`config/juku.yaml`の`seo.competitor_analysis`の重み・辞書
   (`scripts/lib/seo/dictionaries.js`)を調整する。
6. 運用が安定したら競合を追加登録し、cronに登録する。
7. 記事生成へ自動反映したい場合のみ、最後に`use_for_topic_selection: true`にする。

## DBバックアップ

`data/posts.sqlite`に相乗りしているため、既存のバックアップ運用(定期的なファイルコピー)が
そのまま競合分析データにも適用される。SQLiteファイルなので稼働中の単純コピーは避け、
`sqlite3 data/posts.sqlite ".backup backup.sqlite"`のようなオンラインバックアップ手段を使うこと。

## データ削除・再分析

- 特定の競合を停止したい場合は`config/seo_competitors.yaml`で`crawl_enabled: false`にする
  (登録を削除する必要はない)。
- 競合ページを再取得したい場合、対象ページの`content_hash`が変わらない限りDB上は
  「変更なし」として扱われ、`seo_page_analyze.js`の再解析対象にもならない。強制的に
  再解析したい場合は該当行の`last_analyzed_at`をNULLにする(現時点で専用CLIは無い)。
- `seo_gap_calculate.js`は既存候補のstatus(承認/除外等)を保持したまま再計算する
  (人間の判断を上書きしない)。
