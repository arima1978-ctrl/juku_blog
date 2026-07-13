# juku_blog プロジェクト

学習塾(アンイングリッシュグループ 小幡校)の生徒募集(体験授業・問い合わせの獲得)を目的とした、
**BtoC・地域密着型ブログ記事の自動生成〜承認〜WordPress公開システム**。
読者は「小学生・中学生の保護者」が主、「生徒本人」が従。地域の検索流入(例:「◯◯市 塾」)を獲得する。

公開先: `https://an-english.com`(WordPress、教室からのBLOG欄は投稿者ID=13で絞り込まれる構造)

## 全体フロー

```
[毎朝05:00 cron: scripts/daily_blog.sh]
  ↓
0. WordPress状態同期(sync_wordpress_status.js) → 参照インデックス更新(refresh_indexes.js)
  ↓
1. 早瀬(researcher-local)      : 地域ネタ収集 → data/topics/YYYY-MM-DD.json
  ↓
1.5 愛知県高校入試 情報ソース参照機能(features.aichi_exam_research有効時のみ):
    fetch_exam_research.js(決定的)が愛知県高校入試関連か判定・登録ソース取得
    → data/exam_research/YYYY-MM-DD.raw.json
    → 該当時のみ杉浦(exam-fact-structurer)が構造化 → *.facts.json
  ↓
1.6 競合キーワード分析 Keyword Gap Lite(features.competitor_keyword_analysis.use_for_topic_selection
    有効時のみ): seo_topic_candidates_export.js(決定的)が承認済み候補を
    → data/seo_candidates/YYYY-MM-DD.json (候補が無い/機能OFFなら出力しない)
  ↓
2. 智谷(planner-blog-btoc)     : 季節テーマ優先選定・採点(70点未満は原則やり直し)・
                                  CTA種別選定・出典記録(facts.jsonがあれば事実選別も、
                                  seo_candidates/があれば1候補として考慮)
                                  → data/plans/YYYY-MM-DD.json
  ↓
3. 檜山(writer-blog-btoc)      : 塾長本人として執筆(企画内容をfrontmatterへ転記)
                                  → data/drafts/YYYY-MM-DD-{slug}.md (status: written)
  ↓
4. 赤羽(editor-btoc)           : 校正・CTA整合性確認・メタ情報・アイキャッチメタデータ生成
                                  (同ファイル更新, status: edited)
  ↓
4.5 check_similarity.js / check_citations.js / check_exam_facts.js : 過去記事との類似度・
    出典IDの実在・愛知県高校入試ファクトの年度整合性等を決定的に検証しfrontmatterに記録
    (石橋が判定材料として使う。exam_facts_usedが無い記事はcheck_exam_facts.jsが
    status: not_applicableを書き込むのみで無害)
  ↓
5. 石橋(verifier-local)        : 13項目のファクトチェック・コンプライアンス最終判定
    ├─ 軽微な問題は自ら直接修正 → status: verified
    ├─ 要修正 → status: revision_needed (檜山へ差し戻し。最大 generation.max_retry 回)
    └─ 上限超過 → status: escalated (人間判断が必要)
  ↓
sync_draft_to_db.js  : verified→review_pending / escalated→rejected として posts.sqlite に反映
                        (draftにseo_candidate_idがあれば、対象候補をapproved→article_createdへ遷移)
  ↓
[人間がダッシュボードで確認・承認/差し戻し]
  ↓
承認 → 公開期限チェック → OK → WordPress予約投稿(scheduled) / NG → 人間確認へ差し戻し
  ↓
[WordPress側のwp-cronが予約時刻に公開]
  ↓
[毎朝の同期処理でscheduled→published をローカルDBへ反映]
```

## 各エージェントの担当ファイル(厳守)

| エージェント | 読む | 書く |
|---|---|---|
| researcher-local(早瀬) | `config/juku.yaml` | `data/topics/YYYY-MM-DD.json` |
| planner-blog-btoc(智谷) | `config/*.yaml`(`seasonal_topics.yaml`含む), `data/topics/`, `data/recent_titles.json`, `data/rejected_notes.json`, `data/episodes.md`, `data/parent_qa.md`, `data/seo_candidates/`(存在する場合のみ) | `data/plans/YYYY-MM-DD.json` |
| writer-blog-btoc(檜山) | `config/juku.yaml`, `data/plans/`, `data/episodes.md`, `data/parent_qa.md`, `docs/` | `data/drafts/YYYY-MM-DD-{slug}.md` |
| editor-btoc(赤羽) | 同上のdraft, `config/eyecatch_templates.yaml` | 同じdraftファイル(校正・CTA・メタ情報・アイキャッチメタデータ) |
| verifier-local(石橋) | `config/juku.yaml`, `data/topics/`, `data/plans/`, `data/episodes.md`, 対象draft(`similarity_check`/`citation_check`/`exam_fact_check`含む) | 同じdraftファイル(本文修正・fact_check_report・status・retry_count) |
| exam-fact-structurer(杉浦)※機能有効時のみ | `data/exam_research/YYYY-MM-DD.raw.json`(呼び出し時に明示されたパス) | `data/exam_research/YYYY-MM-DD.facts.json` |

他エージェントの担当ファイルを勝手に書き換えないこと。`data/posts.sqlite` への書き込みはどのエージェントも行わない(`scripts/sync_draft_to_db.js` と `scripts/api-server.js` のみが書き込む)。

## status ライフサイクル

**draft frontmatter(パイプライン内部)**: `written` → `edited` → `verified` / `revision_needed` / `escalated`

**posts.sqlite(人間向け)**:
```
review_pending(確認待ち)
  → approved(承認。公開期限チェックへ)
    ├─ 期限内 → scheduled(WordPress側でstatus:futureとして予約済み)
    │            → published(毎朝の同期処理でWordPress側が実際にpublishになったことを検知して自動遷移)
    └─ 期限超過 → approvedのまま据え置き(reviewer_noteに理由を記録、Telegram通知、人間確認)
  → rejected(差し戻し。理由は data/rejected_notes.json に反映)
```
WordPressが実体の正。`scripts/sync_wordpress_status.js`が`scheduled`→`published`以外の遷移(記事消失・想定外ステータス)は自動修復せず`wp_sync_error`に記録するのみ。

## 設定ファイル

| ファイル | 内容 |
|---|---|
| `config/juku.yaml` | 塾名・地域・対象学年・塾長ペルソナ・生成パラメータ・WordPress設定(category_id/author_id/author_display_name)・CTA種別(`cta_types`)・類似度閾値・連続投稿の閾値。**塾ごとにこのファイルだけ差し替えれば他塾展開できる設計**(ハードコード禁止。実装時の監査済み) |
| `config/calendar.yaml` | 曜日別テーマ・季節文脈(月単位の粗い分類) |
| `config/seasonal_topics.yaml` | **日付範囲(publish_window)を持つ季節テーマ候補バンク**。曜日テーマより優先して検討される |
| `config/eyecatch_templates.yaml` | カテゴリー→アイキャッチテンプレートIDのマッピング(メタデータのみ。実画像生成は未実装) |
| `config/aichi_exam_sources.yaml` | 愛知県高校入試 情報ソース参照機能(`features.aichi_exam_research`)のソースバンク(tier/tags/ttl_hours/enabled等)。コード変更なしで追加・削除・無効化・TTL変更ができる |
| `config/seo_competitors.yaml` | 競合キーワード分析(`features.competitor_keyword_analysis`)の競合塾レジストリ(domain/sitemap_url/crawl_enabled等)。未登録ドメインは一切取得しない許可リスト方式 |
| `docs/an-shingaku-jim.md` | 提供コース「アン進学ジム」の実データ |
| `.env`(gitignore対象) | `WP_URL`/`WP_USERNAME`/`WP_APP_PASSWORD`/`TELEGRAM_TOKEN`/`TELEGRAM_CHAT_ID`/`DASHBOARD_URL`/`PORT` |

## 文体・コンプライアンスの要点(詳細は各エージェント定義を参照)

- すべての記事は `author` に定義された**塾長本人が一人称で書いている体**で執筆する
- 実在の生徒エピソード・保護者Q&Aは `data/episodes.md`/`data/parent_qa.md` の**IDが付与された行**のみ使用可(`[EP-001]`/`[QA-001]`形式)。創作・架空IDの記載は禁止(`check_citations.js`が実在確認)
- 誇大表現・個人情報・他塾言及・根拠のない人気表現・発達心理医療の断定は禁止
- 実績数値を使う場合は年次を併記、学校名は`config/juku.yaml`の`area`に実在するもののみ
- 高校名は`area.target_high_schools`(偏差値55以上・minkou.jp基準)のみ使用可
- **AI(生成AI検索)に引用されやすい記事構成(2026-07-11ユーザー指示、全記事共通)**: ①結論を先に書く(導入直後に結論・要点を簡潔提示) ②Q&A形式(疑問形見出し+回答)を1箇所以上入れる ③具体的な数字・固有名詞を積極的に使う(裏付けのない数字の創作は禁止)。檜山が執筆時に満たし、赤羽が校正時に確認・補正する

## 愛知県高校入試 情報ソース参照機能(`features.aichi_exam_research`)

`config/juku.yaml` の `features.aichi_exam_research.enabled`(既定 `false`)で切り替える。無効時は
`fetch_exam_research.js`/`check_exam_facts.js` が即座に無処理で終了し、既存の記事生成フローには
一切影響しない。有効時の流れ:

1. `fetch_exam_research.js`(決定的、LLM不使用): 早瀬の候補(`data/topics/YYYY-MM-DD.json`)が
   愛知県高校入試関連かをキーワード判定し、該当すれば `config/aichi_exam_sources.yaml` の
   登録ソース(Tier1=愛知県教育委員会、Tier2/3=大手塾・教育機関・新聞社系)をrobots.txt尊重・
   SSRF対策(プライベートIP/localhost/メタデータIP拒否・DNSリバインディング対策)・
   レート制限(3秒間隔)・TTLキャッシュ(`exam_research_cache`テーブル、既存`posts.sqlite`に相乗り)
   付きで取得し、PDF(`pdf-parse`)・HTML(`cheerio`)からテキストを抽出、年度(令和⇔西暦)を
   正規化して `data/exam_research/YYYY-MM-DD.raw.json` に出力する。
2. exam-fact-structurer(杉浦、`tools: Read, Write`のみ): raw.jsonを読み、本文に実際に書かれた
   事実のみを出典・年度・Tier付きで構造化して `data/exam_research/YYYY-MM-DD.facts.json` に保存する
   (新規追加LLM呼び出しはこの1回のみ。呼び出し元がファイルパスを明示するため、
   ディレクトリ一覧表示が無くても発見できる)。
3. 智谷が `facts.json` から使う事実を選び `exam_facts_used`/`exam_target_year` を企画に記録
   (無ければ両方null/空配列のまま通常企画にフォールバック)、檜山がTier1は断定・Tier2/3は
   ヘッジ表現で執筆し、記事末尾に実際に使ったソースのみの「参考情報」セクションを追加する。
4. `check_exam_facts.js`(決定的、`check_similarity.js`と同型): 年度不一致・出典欠落・
   登録外ドメイン・Tier2/3の断定・矛盾する事実を検証し `exam_fact_check`(`passed`/`warning`/`blocked`)を
   frontmatterに記録。石橋が14項目目としてこれを確認し、`blocked`は差し戻し対象にする。
5. `blocked`のままapprovedになった場合でも、承認時(`api-server.js`)にWordPress自動投稿を
   ブロックする最終防衛ラインがある(`publish_window_end`超過時と同じ設計パターン)。

## 競合キーワード分析 Keyword Gap Lite(`features.competitor_keyword_analysis`)

`config/juku.yaml`の`features.competitor_keyword_analysis.enabled`(既定`false`)で切り替える。
無効時は`seo_*.js`が即座に無処理で終了し、既存の記事生成フロー・DB・ダッシュボード・
WordPress投稿には一切影響しない。詳細は`docs/seo_competitor_analysis.md`を参照。

概要: 週次バッチ(`scripts/seo_weekly_analysis.sh`、`daily_blog.sh`とは別cron)が
`config/seo_competitors.yaml`に登録された競合サイトをSSRF対策・robots.txt尊重・レート制限
付きで取得し、title/見出し/本文から辞書ベースでキーワード候補を抽出する。自社記事(`posts`)・
Search Console実績・検索需要CSV・順位CSVと突き合わせてKeyword Gap判定(missing/weak/untapped/
shared/strong/content_gap)+優先度スコア(0〜100点)を算出し、ダッシュボードの
「競合キーワード分析」タブで人間が確認・承認・除外する。承認済み候補は
`use_for_topic_selection: true`の場合のみ、`seo_topic_candidates_export.js`経由で
智谷(planner-blog-btoc)の企画候補の1つとして提示される(季節テーマの優先度は変えない)。

## AI Growth Director(`features.growth_director`、Sprint 1: 基盤のみ)

「ブログを書くシステム」から「学習塾専門 AI Growth Director」への進化に向けた上位機能。
既定で無効。`seo_keyword_candidates`(競合キーワード候補)から、URL Allocator
(`scripts/lib/seo/url_allocator.js`)がSEO Task(create_article/improve_existing_article/
improve_school_page/add_internal_links/add_faq/monitor/exclude)を判定し、Opportunity Score
(`scripts/lib/seo/opportunity_score.js`、priority_scoreとは独立)を算出して`seo_tasks`
テーブルへ保存する。ダッシュボードの「Growth Director」タブで確認・承認・除外できるが、
Sprint 1では自動実行(記事生成・WordPress投稿・文章生成)へは一切接続しない。
詳細は`docs/growth_director.md`参照。

## ダッシュボード

- `dashboard.html` + `scripts/api-server.js`(Express、既定ポート3013)
- 記事一覧・詳細プレビュー・承認/差し戻し・エピソード素材入力に加え、企画採用理由・採点・出典・
  類似度チェック・ファクトチェック・アイキャッチ・公開期限・WordPress同期状態を表示
- **承認ボタンを押す前に、予約予定日・期限超過有無・連続投稿警告をプレビュー表示**(`GET /api/posts/:id/schedule-preview`)
- 差し戻し時のメモは `data/rejected_notes.json` に反映され、翌日の智谷が参照する

## 診断・運用コマンド

```bash
npm test                              # node:test。63件の単体・結合テスト
node scripts/dry_run.js [YYYY-MM-DD]  # WordPress投稿・DB登録を一切行わず全項目を確認
node scripts/sync_wordpress_status.js # WordPress公開状態を手動同期(通常はcronが毎朝実行)
node scripts/check_similarity.js <draft>  # 類似度チェックを手動実行
node scripts/check_citations.js <draft>   # 出典ID検証を手動実行
node scripts/fetch_exam_research.js YYYY-MM-DD  # 愛知県高校入試情報の取得を手動実行(features.aichi_exam_research有効時のみ動作)
node scripts/check_exam_facts.js <draft>  # 愛知県高校入試ファクトの年度整合性等を手動検証
bash scripts/seo_weekly_analysis.sh        # 競合キーワード分析の週次バッチを手動実行(詳細はdocs/seo_operations.md)
node scripts/seo_candidates_list.js        # 競合キーワード候補の一覧をCLIで確認
```

## 運用パラメータ(`config/juku.yaml` の `generation`)

- 差し戻し上限: `max_retry`(既定2)
- 1日の生成本数: `daily_count`(既定1)
- 生成バッチ起動時刻: `run_time`(既定05:00、予約投稿時刻にも使用)
- 類似度チェック閾値: `duplicate_threshold`(title/headings/body)
- 連続投稿の警告閾値: `max_same_category_streak`(既定2)/`max_same_audience_streak`(既定3)。**ブロックはせず警告のみ**

## 既知の未実装・制約

- WordPress側で実際に公開時刻を迎えた記事のstatus同期は毎朝のcron任せ(リアルタイムではない)
- アイキャッチは**メタデータのみ**(実画像の生成・合成は未実装)
- `post_analytics`テーブルは将来のSearch Console連携用の**設計のみ**(データ収集処理は未実装)
- 期限切れ記事の**自動差し替え・自動再企画**は未実装(現状は人間確認へ差し戻すのみ。安全側の設計判断)
- `logs/errors.json`の各エラーを個別に「解決済み」にマークするUIは未実装(手動でJSONを編集する運用)
- 愛知県高校入試 情報ソース参照機能は既定で無効(`features.aichi_exam_research.enabled: false`)。
  有効化前に、実運用データで最低1回`node scripts/fetch_exam_research.js`を手動実行し取得結果を
  確認することを推奨(実サイト構造の変更でPDFリンクの位置・件数が変わる可能性があるため)
- 情報ソース管理(有効/無効切替・TTL変更)のUIは未実装。`config/aichi_exam_sources.yaml`を
  直接編集する運用(`calendar.yaml`/`seasonal_topics.yaml`と同様)
- 競合キーワード分析は既定で無効(`features.competitor_keyword_analysis.enabled: false`)。
  競合塾登録はダッシュボードUI未実装で`config/seo_competitors.yaml`直接編集のみ。
  `content_gap`のテーマクラスタリング・推奨タイトル/構成の自動生成・競合ページ本文の
  TTLベース自動パージは未実装(詳細は`docs/seo_troubleshooting.md`)
