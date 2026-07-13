# 競合キーワード分析: 既知の制限・トラブルシューティング

## 既知の制限(MVP範囲外・今後の課題)

- **`content_gap`のテーマクラスタリングは未実装**: 現状のGap判定は正規化キーワードの
  一致ベースで行っており、表記の異なる複数キーワードを1つのテーマとして束ねる
  クラスタリングは行っていない。
- **`data/seo/pages/*.txt`のTTLベース自動パージが未実装**: 競合ページ本文ファイルは
  取得の都度保存されるが、古いファイルを自動削除する仕組みが無い。長期運用すると
  ディスク使用量が増え続けるため、定期的な手動整理を推奨する(該当ファイル名は
  `seo_competitor_pages.content_hash`で特定できる)。
- **JSレンダリングサイトは取得できない**: `cheerio`は静的HTMLのみ解析する。SPA的な
  競合サイトは本文が空(またはごく短い)になり、キーワード抽出がほぼ機能しない。
  この場合、当該ページは実質スキップされたのと同じ結果になる(エラーにはならない)。
- **推奨タイトル・構成(`suggested_title`/`suggested_outline`)は現状未生成**: DBスキーマ・
  ダッシュボード表示は用意済みだが、生成ロジック(テンプレート or LLM)は未実装。
- **`improve_school_page`/`add_internal_links`/`merge_articles`は自動判定しない**:
  `scripts/lib/seo/recommended_action.js`はcreate_article/improve_existing_article/
  monitor/excludeのみを自動判定する。残り3種はダッシュボード上で人間が候補詳細を見て
  手動判断する運用(選択肢としては候補ステータス上で扱える)。
- **fetcher.jsのHTTPトランスポート層(実際のリトライ/リダイレクト追跡)の単体テストは
  無い**: SSRF拒否経路のみユニットテスト済み。愛知県高校入試機能の`fetcher.js`と同じ
  既知のギャップ。

## トラブルシューティング

- **候補が1件も生成されない**: `config/seo_competitors.yaml`に競合が登録されているか、
  `crawl_enabled: true`か、`seo_competitor_crawl.js`→`seo_page_analyze.js`の順に
  実行済みかを確認する。競合ページが1件も取得できていない場合、`seo_gap_calculate.js`は
  何もするものが無く終了する。
- **想定と違うgap_typeになる**: `own_avg_position`/`competitor_count`等の判定材料が
  そもそも無い(GSC未連携・SERP CSV未取込)場合、多くの候補が`missing`寄りに倒れる
  (データ不足時に`strong`と誤判定しないための安全側設計)。GSC連携・順位CSV取込を
  進めると判定精度が上がる。
- **想定より優先度スコアが低い**: `config/juku.yaml`の`seo.competitor_analysis.priority_score_weights`
  を確認する。検索需要データが無い場合、`search_demand`軸は0点になる(需要0そのものでは
  除外されないが、他軸が低いと合計点も低くなる)。
- **Search Console取得が0件のまま**: プロパティURL(`GSC_PROPERTY_URL`)がSearch Console上の
  登録形式と一致しているか、サービスアカウントを「閲覧者」として追加済みか確認する
  (`docs/search_console_setup.md`参照)。反映遅延・低トラフィックサイトでは0件が
  正常な結果でもある。
- **CSV取込でキーワードが取り込まれない**: 列名がエイリアスに一致しているか確認する
  (`docs/keyword_planner_csv_import.md`/`docs/serp_csv_import.md`の対応表参照)。
  キーワード列(またはSERPの場合はドメイン列)が空の行はエラーとして記録されスキップされる。
- **智谷が競合キーワード候補を全く使わない**: `use_for_topic_selection: false`のままでは
  `data/seo_candidates/`自体が出力されない(意図した挙動)。有効化しても、季節テーマが
  採用された日は優先されるため候補が使われないことがある(意図した挙動)。
