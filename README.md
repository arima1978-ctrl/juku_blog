# juku_blog

学習塾向け 地域密着ブログ自動生成〜承認〜WordPress公開システム。

パイプラインの全体設計・各エージェントの役割は [`CLAUDE.md`](./CLAUDE.md) を、
外部共有用の仕様サマリーは [`docs/system_spec.md`](./docs/system_spec.md) を参照。

## セットアップ(初回のみ)

1. Node.js 22.5 以上が必要(`node:sqlite` 組み込みモジュールを使用するため。ネイティブビルドが必要な
   `better-sqlite3` 等は使わない設計なので、Windows開発機でもビルドツール無しで動く)。
2. 依存パッケージをインストール:
   ```
   npm install
   ```
3. `config/juku.yaml` を実際の塾情報に書き換える(塾名・地域・学校名・塾長ペルソナ等。現状はプレースホルダー)。
4. DBを初期化:
   ```
   npm run init-db
   ```

## 手動での動作確認

パイプライン全体をその場で実行する(cronを使わずに1回だけ試したい場合):

```
bash scripts/daily_blog.sh
```

ダッシュボードを起動する(既定ポート3013。`PORT`環境変数で変更可):

```
npm run dashboard
```

ブラウザで `http://localhost:3013` を開くと、記事一覧・詳細プレビュー・承認/差し戻し・
エピソード素材の入力ができる。

## 診断コマンド

```bash
npm test                              # 単体・結合テスト(node:test、外部依存なし)
node scripts/dry_run.js [YYYY-MM-DD]  # WordPress投稿・DB登録を一切行わず、承認した場合に
                                       # 何が起きるかを確認する(採点・類似度・出典・予約日・
                                       # CTA・WordPress事前検証・タグ候補等)
node scripts/sync_wordpress_status.js # WordPress公開状態をローカルDBへ手動同期
```

## cron設定(本番運用)

`config/juku.yaml` の `generation.run_time`(既定 `05:00`)に合わせて、以下のようなcrontabを設定する
(サーバー上のプロジェクトパスに合わせて `cd` の行を書き換える):

```cron
0 5 * * * cd /path/to/juku_blog && ./scripts/daily_blog.sh >> logs/cron.log 2>&1
```

ダッシュボード(`scripts/api-server.js`)は常駐プロセスとして立てておく(pm2等での常時起動を推奨):

```
pm2 start scripts/api-server.js --name juku-blog-dashboard
```

## ディレクトリ構成

```
juku_blog/
├── CLAUDE.md                  ← エージェント共通の設計・データフロー資料
├── README.md                  ← このファイル
├── config/
│   ├── juku.yaml               ← 塾固有情報(塾ごとに差し替え。ハードコード禁止)。features.aichi_exam_research/competitor_keyword_analysis等の機能フラグもここ
│   ├── calendar.yaml           ← 曜日別テーマ・季節文脈
│   ├── seasonal_topics.yaml    ← 日付範囲を持つ季節テーマ候補バンク
│   ├── eyecatch_templates.yaml ← カテゴリー→アイキャッチテンプレートID
│   ├── aichi_exam_sources.yaml ← 愛知県高校入試 情報ソースバンク(tier/tags/ttl_hours/enabled等)
│   └── seo_competitors.yaml    ← 競合キーワード分析の競合塾レジストリ(features.competitor_keyword_analysis有効時のみ使用)
├── .claude/agents/
│   ├── researcher-local.md     ← 早瀬: 地域ネタ収集
│   ├── planner-blog-btoc.md    ← 智谷: 企画・採点・出典記録・CTA選定
│   ├── writer-blog-btoc.md     ← 檜山: 執筆(塾長本人として)
│   ├── editor-btoc.md          ← 赤羽: 校正・CTA・メタ情報・アイキャッチ
│   ├── verifier-local.md       ← 石橋: ファクトチェック・コンプライアンス(14項目)
│   └── exam-fact-structurer.md ← 杉浦: 愛知県高校入試の生データ→構造化事実(features.aichi_exam_research有効時のみ)
├── scripts/
│   ├── daily_blog.sh              ← 毎日実行するパイプライン本体(cron対象)
│   ├── seo_weekly_analysis.sh     ← 競合キーワード分析の週次バッチ(daily_blog.shとは別cron、features.competitor_keyword_analysis有効時のみ動作)
│   ├── init_db.js                 ← posts.sqlite 初期化
│   ├── sync_draft_to_db.js        ← 完成したdraftをposts.sqliteへ反映(seo_candidate_id連携も含む)
│   ├── check_similarity.js        ← 過去記事との類似度チェック(石橋の前に実行)
│   ├── check_citations.js         ← 出典IDの実在検証(石橋の前に実行)
│   ├── fetch_exam_research.js     ← 愛知県高校入試情報の取得・キャッシュ(features.aichi_exam_research有効時のみ動作)
│   ├── check_exam_facts.js        ← 愛知県高校入試ファクトの年度整合性等を検証(石橋の前に実行)
│   ├── sync_wordpress_status.js   ← WordPress公開状態をDBへ同期(daily_blog.shの冒頭)
│   ├── dry_run.js                 ← 投稿・DB登録せず診断表示
│   ├── refresh_indexes.js         ← 過去タイトル/差し戻し理由のインデックス再生成
│   ├── get_draft_status.js        ← 当日draftのstatus取得(daily_blog.shのループ制御用)
│   ├── log_error.js               ← logs/errors.json への記録
│   ├── api-server.js              ← ダッシュボード用Expressサーバー(/api/seo/*含む)
│   ├── seo_competitor_crawl.js         ← 競合サイト取得(sitemap優先、SSRF/robots/レート制限)
│   ├── seo_page_analyze.js             ← 取得済みページからキーワード候補抽出
│   ├── seo_gap_calculate.js            ← Gap判定+優先度スコア算出、seo_keyword_candidates更新
│   ├── seo_gsc_sync.js                 ← Search Console実績取得(features.*.search_console_enabled有効時のみ。日次別cron推奨)
│   ├── seo_keyword_metrics_import.js   ← キーワードプランナーCSV取込
│   ├── seo_serp_import.js              ← 検索順位CSV取込
│   ├── seo_candidates_list.js          ← 候補一覧CLI
│   ├── seo_candidates_approve.js       ← 候補承認CLI
│   ├── seo_candidates_reject.js        ← 候補除外CLI
│   ├── seo_candidates_queue.js         ← 承認済み候補を記事生成キューへ(手動)
│   ├── seo_topic_candidates_export.js  ← 智谷への候補提示(data/seo_candidates/YYYY-MM-DD.json出力、決定的・LLM不使用)
│   └── lib/                       ← 共有ヘルパー(config/db/schedule/similarity/citations/
│                                      wordpress/wordpress_validation/wp_sync/telegram/season/
│                                      seasonal_topics/episodes/draft/json_field/seo_db)
│       ├── exam_research/         ← 愛知県高校入試機能専用(source_registry/fetcher/ssrf_guard/
│       │                              robots_guard/html_extract/pdf_extract/year_normalizer/
│       │                              cache/fact_validator/citation_builder)
│       └── seo/                   ← 競合キーワード分析専用(fetcher/robots_guard/html_extract/
│                                      sitemap_parser/url_normalize/crawl_frontier/normalizer/
│                                      dictionaries/keyword_extractor/gap_classifier/priority_scorer/
│                                      recommended_action/own_content_analyzer/csv_parser/
│                                      keyword_metrics_provider/serp_provider/search_console_provider)
├── db/schema.sql               ← posts.sqlite のスキーマ(post_analyticsは将来設計のみ、
│                                  exam_research_cache/exam_research_updatesは愛知県高校入試機能用、
│                                  seo_*は競合キーワード分析用)
├── dashboard.html               ← ダッシュボードUI(競合キーワード分析タブ含む)
├── test/                        ← node:testによる単体・結合テスト(exam_*.test.jsが愛知県高校入試機能分、seo_*.test.jsが競合キーワード分析分)
└── data/
    ├── topics/YYYY-MM-DD.json   ← 早瀬の出力(gitignore対象)
    ├── plans/YYYY-MM-DD.json    ← 智谷の出力(gitignore対象)
    ├── drafts/YYYY-MM-DD-*.md   ← 檜山〜石橋が書き換えるdraft(gitignore対象)
    ├── exam_research/*.json     ← 愛知県高校入試機能の中間ファイル(raw.json/facts.json、gitignore対象)
    ├── seo_candidates/YYYY-MM-DD.json ← 智谷への競合キーワード候補提示ファイル(gitignore対象。無い日は智谷が無視)
    ├── seo/pages/*.txt          ← 競合ページ本文(gitignore対象。DBにはメタデータのみ保持)
    ├── episodes.md              ← 塾長の実体験ストック、[EP-001]形式のID付き(コミット対象)
    ├── parent_qa.md             ← 保護者との実際のやり取り、[QA-001]形式のID付き(コミット対象)
    ├── recent_titles.json       ← 過去90日タイトル(自動生成、gitignore対象)
    ├── rejected_notes.json      ← 差し戻し理由(自動生成、gitignore対象)
    └── posts.sqlite             ← 記事DB(gitignore対象。init-dbで生成)
```

## WordPress自動投稿・予約投稿(実装済み)

ダッシュボードで「承認」を押すと、直近の予約枠の翌日を自動計算し(1日1本ペースを維持)、
公開可能期間(季節テーマの場合)を超えていなければ `scripts/lib/wordpress.js` がWordPress REST API
(`/wp-json/wp/v2/posts`)へ`status:future`で予約投稿する。投稿前に投稿者ID・表示名・カテゴリーIDの
事前検証を行い、想定と異なるアカウント/カテゴリーへの誤投稿を防ぐ。結果は`scripts/lib/telegram.js`
経由でTelegramにも通知される(`.env`未設定ならスキップ)。WordPress側で実際に公開されたかどうかは
毎朝`scripts/sync_wordpress_status.js`がローカルDBへ同期する。

セットアップ手順(`.env.example` も参照):

1. WordPress管理画面で、**実際にブログを書いている塾長本人のアカウント**(投稿者権限)で
   アプリケーションパスワードを発行する(専用botアカウントを別途作ると、投稿者IDで絞り込まれる
   サイト側の「教室からのBLOG」一覧に反映されないことがあるため、実アカウントを使うこと)
2. プロジェクト直下に `.env` を作成し、`WP_URL` / `WP_USERNAME` / `WP_APP_PASSWORD` を設定する
   (Telegram通知も使う場合は `TELEGRAM_TOKEN` / `TELEGRAM_CHAT_ID` も設定)
3. `config/juku.yaml` の `wordpress.category_id`/`author_id`/`author_display_name` を実際の値に
   設定する(教室ごとに同名の子カテゴリーが並ぶ構造のサイトでは、カテゴリーは名前検索ではなく
   ID指定にすること)

`.env`が未設定、または投稿者/カテゴリーの事前検証に失敗した場合は投稿がエラーになり
`logs/errors.json`に記録されるが、承認自体は成立する(ステータスは`approved`のまま残り、
ダッシュボードで再度「承認」を押すと投稿をリトライできる)。承認済み記事は引き続き
「本文コピー」ボタン(HTML形式/テキスト形式)でも取得できるので、自動投稿が失敗した場合の
手動フォールバックとして使える。

## 愛知県高校入試 情報ソース参照機能(実装済み・既定は無効)

愛知県高校入試に関する記事で、入試日程・制度変更を公式情報で確認し、記事末尾に参照元を
自動表示する機能。**既定で無効**(`config/juku.yaml`の`features.aichi_exam_research.enabled: false`)
になっており、有効化しない限り既存の記事生成には一切影響しない。

### 機能ON・OFF

```yaml
# config/juku.yaml
features:
  aichi_exam_research:
    enabled: true   # 既定はfalse
```

### 情報ソース設定ファイル

`config/aichi_exam_sources.yaml`で管理する(コード変更なしで追加・削除・無効化・TTL変更が可能)。

```yaml
sources:
  - id: aichi_board_of_education
    name: "愛知県教育委員会 高等学校教育課"
    base_url: "https://www.pref.aichi.jp/"
    entry_url: "https://www.pref.aichi.jp/soshiki/kotogakko/0000027366.html"
    tier: 1              # 1=一次情報(断定可)/2・3=参考情報(断定禁止)
    source_type: official
    tags: [exam_schedule, selection_system, ...]  # 記事テーマとのマッチングに使う用途タグ
    ttl_hours: 168       # キャッシュ有効期間(時間)
    enabled: true        # falseで一時停止(削除せず無効化)
    supports_pdf: true   # entry_url配下のPDFリンクも取得対象にする
classification_keywords: ["高校入試", "入学者選抜", ...]  # このいずれかを含むテーマを対象と判定
```

**Tierの意味**: Tier1(愛知県教育委員会等の一次情報)は日程・制度・倍率等を断定的に記載してよい。
Tier2・3(大手塾・教育機関・新聞社系、地域塾等)は偏差値・内申点・合格ボーダー等の参考値として
扱い、公式情報のように断定しない(執筆時・検証時の両方でこのルールを適用する)。

**用途タグ一覧**(`extractTagsFromText`が判定するもの。詳細は`scripts/lib/exam_research/topic_classifier.js`):
`exam_schedule`/`selection_system`/`recommendation`/`special_selection`/`general_selection`/
`interview`/`target_deviation`/`average_score`/`subject_analysis`/`application_status`/`capacity`等。

### キャッシュ・TTL

取得結果は既存`posts.sqlite`の`exam_research_cache`テーブルに保存される(別DBは新設しない)。
TTL内はネットワークアクセスを行わない。ソースごとのTTLは`ttl_hours`で個別に設定できる
(既定値の目安: 愛知県教育委員会=168時間/7日、入試速報・ニュース=24時間、大手塾・地域塾の
解説記事=720時間/30日)。

### 手動再取得・診断

```bash
node scripts/fetch_exam_research.js YYYY-MM-DD  # 対象日のネタが入試関連なら取得を実行
node scripts/check_exam_facts.js <draft>        # draftのexam_facts_usedを検証
```

キャッシュを強制的に無効化して再取得したい場合は、`exam_research_cache`テーブルの該当行を
削除するか、TTLが切れるのを待つ。

### Windows 11でのセットアップ

追加のセットアップ手順は不要。`npm install`で`pdf-parse`(純JS実装、ネイティブビルド不要)・
`cheerio`・`robots-parser`が導入される(いずれもWindows開発機のビルドツール無し環境で動作確認済み)。

### 年度不一致時の挙動

記事の対象年度(`exam_target_year`)と、使用する事実の年度が異なる場合、`check_exam_facts.js`が
`YEAR_MISMATCH`エラーとして検出し`exam_fact_check.status`を`blocked`にする(前年との比較データは
`comparison_year`を明示すればブロック対象外)。`blocked`の記事は石橋が差し戻し対象として扱う。

### WordPress投稿がブロックされる条件

`exam_fact_check.status`が`blocked`(年度不一致・出典欠落・登録外ドメイン・Tier2/3の断定・
矛盾する事実のいずれか)の記事は、承認時にWordPress自動投稿がブロックされ、承認自体は
`approved`のまま残る(`publish_window_end`超過時と同じ扱い)。ダッシュボードで内容を確認し、
差し戻すか手動対応する。

### 新しい情報ソースの追加方法

`config/aichi_exam_sources.yaml`の`sources`配列に1件追記するだけでよい(コード変更不要)。
`tags`は`scripts/lib/exam_research/topic_classifier.js`の`TAG_KEYWORD_MAP`と一致させる
(新しいタグを使う場合はそちらにキーワード対応も追記する)。

### トラブルシューティング

- **PDFのテキストが抽出できない**: 画像PDF(スキャンしたPDF等)はテキスト抽出できない仕様。
  `parse_status: parse_failed`として記録され、記事生成はクラッシュしない(該当事実が
  使えないだけ)。
- **想定より古い年度の情報が混ざる**: 官公庁のページは当年度と過去数年分のアーカイブが
  同一ページに並ぶことが多い。`fetch_exam_research.js`は当年度以外のリンクを事前に除外する
  設計だが、リンクテキストに年度表記が無いページ構成の場合は判定できないことがある。
- **想定より件数が少ない/多い**: `MAX_PDF_LINKS_PER_SOURCE`(`scripts/fetch_exam_research.js`)で
  1ソースあたりの取得件数に上限がある(既定10件)。

## 競合キーワード分析 Keyword Gap Lite(実装済み・既定は無効)

近隣の競合塾が扱っている検索テーマと、自社サイトが実際にGoogle検索で表示されているキーワードを
比較し、次に作成・改善すべき記事候補を提案する機能。**既定で無効**
(`config/juku.yaml`の`features.competitor_keyword_analysis.enabled: false`)になっており、
有効化しない限り既存の記事生成・DB・ダッシュボード・WordPress投稿には一切影響しない。

詳細は [`docs/seo_competitor_analysis.md`](./docs/seo_competitor_analysis.md) を参照。
運用手順は [`docs/seo_operations.md`](./docs/seo_operations.md)、
Search Console認証設定は [`docs/search_console_setup.md`](./docs/search_console_setup.md)、
CSV取込は [`docs/keyword_planner_csv_import.md`](./docs/keyword_planner_csv_import.md) /
[`docs/serp_csv_import.md`](./docs/serp_csv_import.md)、既知の制限は
[`docs/seo_troubleshooting.md`](./docs/seo_troubleshooting.md) を参照。

### 機能ON・OFF

```yaml
# config/juku.yaml
features:
  competitor_keyword_analysis:
    enabled: false               # 既定はfalse。全体の有効/無効
    use_for_topic_selection: false  # trueでも人間が承認した候補のみ智谷の企画候補になる
    crawl_enabled: false         # 競合サイトの実クロールを行うか
    search_console_enabled: false   # Search Console API連携を行うか
```

### 最小構成での有効化手順

1. `config/seo_competitors.yaml`に競合塾を1件登録する(`crawl_enabled: true`)
2. `config/juku.yaml`の`features.competitor_keyword_analysis.enabled`/`crawl_enabled`を`true`にする
3. `node scripts/seo_competitor_crawl.js --dry-run`で取得内容を確認してから本実行する
4. `node scripts/seo_page_analyze.js` → `node scripts/seo_gap_calculate.js`を実行する
5. ダッシュボードの「競合キーワード分析」タブで候補を確認・承認する
6. 記事生成に自動反映したい場合のみ`use_for_topic_selection: true`にする(既定false、任意)
