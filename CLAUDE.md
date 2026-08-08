# juku_blog プロジェクト

学習塾(アンイングリッシュグループ 小幡校)の生徒募集(体験授業・問い合わせの獲得)を目的とした、
**BtoC・地域密着型ブログ記事の自動生成〜承認〜WordPress公開システム**。
読者は「小学生・中学生の保護者」が主、「生徒本人」が従。地域の検索流入(例:「◯◯市 塾」)を獲得する。

公開先: `https://an-english.com`(WordPress、教室からのBLOG欄は投稿者ID=13で絞り込まれる構造)

## WordPressへの書き込みは記事(posts)のみ(最上位ルール、2026-07-29)

**WordPressへの書き込みは記事(`posts`テーブル由来の記事)のみに限定する。** 固定ページ・
ブランドページ・カスタム投稿・メニュー・ウィジェット等、記事以外への変更は原則禁止。
どうしても必要な場合は、変更内容の差分を提示してユーザーの明示承認を得てから1件ずつ実行する
(自動実行・一括実行は不可)。`scripts/seo_brand_page_draft_apply.js`の`--confirm`も、
この承認が確認できる場合のみ使用してよい(スクリプト自体は既定で差分プレビューのみ・書き込みなし
という安全設計だが、それとは別にこの承認ルールが上位で適用される)。

AI Growth Directorが生成する`improve_school_page`/`improve_brand_page`タスクは、
今後も**判断材料として提案(Task/Page Plan/Page Draftの生成)されるのは可**(記事以外の
改善余地を可視化する価値があるため)。ただし**実際の反映(WordPress書き込み)は常にこの
例外承認フローを通ること**。Page Plan/Page Draftの生成・DB保存自体はWordPressへの
書き込みを伴わないため通常の運用で問題ない(承認が必要なのは最終の反映ステップのみ)。

## status等のenumフィールドに新しい値を追加する際の注意(2026-07-29)

`status`(またはそれに類するenum的な状態フィールド)に新しい値を追加・使用する場合、そのフィールドを
条件にDBを読んでいる箇所を全数確認し、新しい値が意図せず除外されないか確認すること(過去に
`seo_tasks.status`・`seo_keyword_candidates.status`で同型バグが複数回発生している。値の除外は
コメント等で意図を明記し、単なる書き漏れと区別できるようにする)。

## 本番環境での破壊的操作は事前承認必須(厳守)

2026-07-17、本番サーバー(`data/posts.sqlite`)上で試行錯誤中に `rm data/posts.sqlite` が直接実行され、
実記事2件・Google Search Console実績15万件超・SEOタスク70件等が失われるインシデントが発生した
(直前に取っていた手動バックアップから復旧できたが、根本的には防げたはずの事故)。これを踏まえ、
**本番環境(SSH接続先サーバー)に対する以下の操作は、実行前に必ず内容を明示してユーザーの承認を得ること**。
ローカル開発環境やテスト用DB(`JUKU_BLOG_DB_PATH`等で明示的に切り替えた一時ファイル)には適用されない。

- `data/posts.sqlite` の削除・上書き・スキーマ変更を伴う操作(`rm`、直接の `DELETE`/`DROP`/`UPDATE` 等の
  手動SQL実行、`init_db.js` の実行等)
- `config/juku.yaml` 等の設定ファイルの変更(既存の値を書き換える場合。新規ファイル追加は対象外)
- `git checkout --`/`git reset`等、コミットされていない変更を破棄する操作
- `pm2` プロセスの停止・削除(再起動 `restart` はデプロイの一部として許可)
- 上記以外でも、取り消しが困難・本番データや稼働に影響し得る操作全般

**必ず作業前にバックアップを取ること**(`cp data/posts.sqlite data/posts.sqlite.<用途>-<タイムスタンプ>.bak`)。
バックアップの自動化は `scripts/backup_db.sh`(日次cron、直近7世代保持)を参照。
診断・調査目的の読み取り専用操作(`SELECT`、`sqlite_master`の参照等)は承認不要で自由に行ってよい。

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
| `config/school_pages.yaml` | AI Growth Director用の自社校舎ページレジストリ(id/url/target_areas/enabled等)。`config/seo_competitors.yaml`とは完全に分離。本文取得・解析は行わない |
| `config/alert_known_causes.yaml` | バッチ監視アラートの既知原因パターン(pattern正規表現→remedy対処法)。`scripts/lib/known_causes.js`が`logs/errors.json`の関連エラーと照合し、一致すればアラート文面に対処法を直書きする |
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

**queuedの優先消化(2026-07-30〜、塾曜日<月火木土>限定)**: `status: "approved"`止まりの候補は
従来通り手順4b(季節テーマが決まらなかった日のみの受動的検討)のままだが、ダッシュボードで
「キューへ送る」操作を受けた`status: "queued"`の候補は、人間の明示的な指名として季節テーマ
バンクより優先される(智谷の手順0)。`seo_topic_candidates_export.js`がqueuedを上限無しで
キュー投入順(FIFO、`updated_at`昇順で代用。専用カラムが無いための代替実装であり、queued中に
別更新が入ると順序がズレる既知の限界がある。同スクリプトのコード内コメント参照)に並べて出力し、
approvedは従来通りpriority_score順で残り枠を埋める。習い事枠(水・金・日、Tier A/A'/B/C)には
一切影響しない。消化後のstatus遷移(`queued`→`article_created`)はsync_draft_to_db.jsの既存の
遷移処理がそのまま扱える(遷移元statusの制約が無いため、コード変更不要だった)。

## AI Growth Director(`features.growth_director`、Sprint 1: 基盤 / Sprint 2: GSC連携・校舎ページ認識 / Sprint 3: Page Plan / Sprint 3.5: 人間レビュー / Sprint 3.6: Page Draft / Sprint 3.7: Stale再生成 / Sprint 3.8: ROI Priority Score / Sprint 3.9: AI Weekly Director)

「ブログを書くシステム」から「学習塾専門 AI Growth Director」への進化に向けた上位機能。
既定で無効。`seo_keyword_candidates`(競合キーワード候補)から、URL Allocator
(`scripts/lib/seo/url_allocator.js`)がSEO Task(create_article/improve_existing_article/
improve_school_page/add_internal_links/add_faq/monitor/exclude)を判定し、Opportunity Score
(`scripts/lib/seo/opportunity_score.js`、priority_scoreとは独立)を算出して`seo_tasks`
テーブルへ保存する。ダッシュボードの「Growth Director」タブで確認・承認・除外できるが、
自動実行(記事生成・WordPress投稿・文章生成)へは一切接続しない。
校舎ページ対応テンプレート(地域×塾/指導形態/無料体験)は、`config/school_pages.yaml`
(自社校舎ページレジストリ、競合設定とは完全分離)に登録があれば`improve_school_page`、
無ければ`create_article`ではなく`monitor`と判定する。Search Console実績
(`scripts/seo_gsc_sync.js`)は日付ごとに正しく保存され、`gap_type`判定経由で間接的に
Opportunity Scoreへ反映される(計算式自体は変更しない)。
同一校舎ページに複数Taskが並行する場合、Page Task Grouper(`scripts/lib/seo/page_task_grouper.js`)
がPrimary/Supporting/Excludedへ決定的に分類し、Supporting Fact Check
(`scripts/lib/seo/supporting_task_fact_checker.js`、ページ本文照合。GSCは提供事実の証拠には
使わない)を経て、Task本体とは別概念の**Page Plan**(`seo_page_plans`テーブル)として
`scripts/seo_page_plan_generate.js`(既定dry-run、`--save`明示時のみ保存)経由で保存できる
(Task statusは変更しない。統合Draft生成は未実装)。
Page Planの人間レビュー(`proposed→reviewing→approved/rejected`、`approved`は終端、
`rejected`もV1では終端)は`scripts/lib/seo/page_plan_review.js`(決定的な遷移バリデーション)+
`scripts/lib/seo_db.js`の`transitionSeoPagePlanStatus()`(status更新+レビュー履歴
`seo_page_plan_reviews`へのINSERTを同一トランザクションで実行、expected statusによる競合検知
あり)で管理する。状態変更は`scripts/seo_page_plan_review.js`CLI(既定dry-run、`--save`明示時
のみ反映)のみに限定し、読み取り専用API(`GET /api/seo/page-plans`・`GET /api/seo/page-plans/:id`)
は追加したが、認証機構が無いapi-server.jsに承認/却下の書き込みAPIは実装していない
(安全性を優先した設計判断)。
Page Planが`approved`になると、`scripts/lib/seo/page_draft_prompt_builder.js`
(PROMPT_VERSION=`page-draft-v1`、Task単位Draft`v3`とは別管理)がPrimary/verified Supporting/
Excluded/pageContextから統合Prompt(`<page_plan_data>`/`<excluded_tasks>`/`<page_content>`タグで
区切るPrompt Injection対策込み)を組み立て、専用agent`seo-page-draft-writer`(`tools: Read, Write`
のみ)が生成し、`scripts/lib/seo/page_draft_response_validator.js`で検証した上で、Task本体・
Page Planとは別概念の**Page Draft**(`seo_page_drafts`テーブル、1 Page Planにつき複数世代を
upsertせず常にINSERTで履歴保持)として`scripts/seo_page_draft_generate.js`(既定dry-run、`--save`
明示時のみ保存)経由で保存できる。`approved`以外のPage Planは生成拒否
(`page_plan_not_approved`)、Page Plan作成後にページ本文が変わっていれば生成拒否
(`page_plan_content_stale`)、生成中にPage Planが変更されていれば保存拒否
(`page_plan_changed_during_generation`)。Page Plan・SEO Taskのstatusは変更しない。
承認後にページ本文が変わりPage Planが古くなった(stale)場合、`scripts/lib/seo/page_plan_staleness.js`
の`evaluatePagePlanStaleness()`(既存Draft Previewのstale判定と共通化、外部エラーコードは
不変)で判定し、`scripts/seo_page_plan_regenerate.js`CLI(既定dry-run、`--save`明示時のみ反映)
経由で、既存のPage Task Grouper/Supporting Fact Check/Page Plan Builderを再利用して最新本文から
内容を再計算できる。`scripts/lib/seo_db.js`の`regenerateStaleSeoPagePlan()`が、
現在status→stale→内容UPDATE→stale→proposedを1トランザクションで実行し(途中失敗時はROLLBACK)、
必ず人間の再レビューへ戻す(stale→proposed以外の直接遷移は許可しない)。短期案として1ページ1
Page Plan方式を維持するため、承認時点のPrimary/Supporting/Excluded等の内容はPage Plan行の
上書きにより残らない(status遷移履歴のみ`seo_page_plan_reviews`に残る。長期的にはPage Plan
バージョン管理が必要)。
`scripts/lib/seo/impact_calculator.js`(CTRカーブ+順位押し上げロジックによる期待CV増)・
`scripts/lib/seo/difficulty_score.js`(自前競合レジストリ+既得権益ディスカウントによる
1〜100の難易度)・`scripts/lib/seo/roi_priority_score.js`(Impact×Difficultyのバッチ内
min-max正規化)が、`seo_tasks`へ`opportunity_score`とは独立した`roi_priority_score`等
6カラムを追加保存する。これを主軸に、`scripts/seo_weekly_director.js`(既定dry-run、
`--save`明示時のみ保存)が工数予算(既定60分)・タスクタイプ多様性(同タイプ最大2件)の
制約下で毎週3〜5件を決定的に選定し(3段階フォールバック)、`scripts/lib/seo/weekly_draft_dispatcher.js`
が校舎ページ紐づきTaskはPage Plan経由、単発Taskは`buildDraftPreview()`経由でDraft Prompt
を事前生成(Claude Code subagentは起動しない)、`seo_weekly_recommendations`テーブル
(新規1枚のみ、`UNIQUE(batch_date)`)へ選定結果とPromptファイルパスの参照をまとめて保存する。
詳細は`docs/growth_director.md`参照。

### ブランドページ対応(`improve_brand_page`、2026-07-29〜)

そろばん/英会話/習字/プログラミング/将棋等、校舎に属さないサイト全体共通のブランドページを
`config/brand_pages.yaml`(`school_pages.yaml`と同じ思想、branch_idを持たない、
`content_category`固定・`wp_page_id`保持)に登録すると、URL Allocatorが該当キーワードを
`improve_brand_page`タスクへ割り当てる(Page Task Grouper/Weekly Draft Dispatcher/
Impact Calculatorも`improve_school_page`と同様に扱う)。`scripts/seo_brand_page_draft_apply.js`
はPage DraftをWordPress REST API経由で反映できる半自動スクリプトだが、**冒頭の
「WordPressへの書き込みは記事(posts)のみ」ルールにより、実際の反映(`--confirm`)は
その承認フローを通った場合のみ使用する**(brand_page_registry.jsによる本文取得の許可リスト
拡張・Task/Page Plan/Page Draftの生成自体はWordPress書き込みを伴わないため通常運用でよい)。
2026-07-29時点の方針: ブランドページ本文の直接改善よりも、通常のブログ記事(習い事テーマ、
`config/seasonal_topics.yaml`の`naraigoto-*`エントリ)で検索需要を受け止め、記事内リンク・
CTA(`soroban_trial`等)で各ブランドページへ誘導する「記事ファースト」を主軸とする
(ブランドページ改善タスクは判断材料としての提案生成は継続)。

### 習い事ブログの年間バランス構造化(2026-07-29〜)

優先度方式のみでは、緊急季節テーマ(priority 70〜90)が常にウインドウ内に存在し続けるため、
習い事テーマ(priority 45〜58)が実際にはほぼ選ばれない実データ(7/20〜7/29の10日間、一度も
選定されず)が確認された。これを踏まえ、曜日ローテーション(`config/calendar.yaml`)に
`locked_category`を導入し、**水・金・日を「習い事紹介」専用枠**にした(優先度競争に依存しない
構造的保証。2026-07-29当初は日曜のみで開始し、同日中に週1→週3(塾4:習い事3)へ拡張)。
塾記事は週4本(小幡校のSEO測定指標定義には影響しない)。

- 智谷(`planner-blog-btoc.md`手順1)は、その日の`locked_category`と一致するテーマのみを
  検討対象に絞り込み、他カテゴリへは絶対にフォールバックしない。絞り込んだ候補内で
  Tier A(季節限定、`season_dependency: high`。例: 書き初め12〜1月・プログラミング夏体験7〜8月)
  → **Tier A'(将棋の下限保証、直近8週間選ばれていなければ優先採用)** → Tier B(英会話・
  そろばん・習字・プログラミングの主4ジャンルのみでローテーション)→ Tier C(`data/seo_candidates/`
  の`content_category: naraigoto`候補)の順で1件を選ぶ。採用したTierは`naraigoto_tier`として
  `data/plans/`に記録される(初週レビュー用)。
- 5ジャンル(そろばん/英会話/習字/プログラミング/将棋)全てに`naraigoto-<ジャンル>-local`という
  通年ローカルアンカー(`守山区 そろばん`等、地域名+一般語)が揃っている。英会話のみKeyword Gap
  Lite上で実測需要(月間検索720)があるためpriorityをやや高く(58)、他4ジャンルは横並び(56)。
  ただし将棋はTier Bの通常ローテーションから除外し、Tier A'の下限保証(年6〜7本ペース)のみで
  カバーする(増枠分は主4ジャンルへ配分するというユーザー決定、2026-07-29)。
- Tier Bのジャンルローテーションは、`data/recent_titles.json`(`listTitlesSince()`が
  `seasonal_topic_id`も返すよう拡張済み)から`naraigoto-<ジャンル>-*`のid命名規則でジャンル別の
  最終選定日を逆算し、主4ジャンルの中で最も長く選ばれていないジャンルを優先する。9〜10月頃、
  Keyword Gap Lite/GSC実績が習い事ジャンルにも貯まった段階でpriority・配分を実測データに
  基づき再調整する。
- `scripts/lib/theme_calendar.js`(ダッシュボード「テーマカレンダー」タブのプレビュー)も同じ
  `locked_category`絞り込みを再現しており、実際の生成結果とプレビューが食い違わない
  (ただしTier A'/Bのジャンルローテーション自体は智谷側のLLM判断のため、プレビュー側は
  簡易的な優先度順選択にとどまる)。
- **あま本部校には適用しない**(2026-07-29ユーザー決定、当面は塾記事のみに集中)。
  `branches/ama-honbu/config/calendar.yaml`が校舎専用ファイルとして既に存在するため、
  `scripts/lib/config.js`のbranch-aware解決(校舎別ファイルが存在すれば完全に上書きし、
  共有ファイルとのフィールド単位マージは行わない)により、共有`config/calendar.yaml`の
  `locked_category`は自動的にあま本部へ波及しない。この非波及は`test/branch_aware_config.test.js`
  で固定済み。将来あま本部にも導入する場合は、同ファイルへの`locked_category`追加に加え、
  `branches/ama-honbu/config/seasonal_topics.yaml`(現状naraigoto系0件)へあま市版の
  エントリを新規に用意する必要がある。

## SEO効果測定 週次スナップショット(2026-07-27〜)

小幡校の10/25プレゼン用エビデンス構築を目的に、`scripts/seo_metrics_snapshot_generate.js`が
週次バッチ(`seo_weekly_analysis.sh`、Gap判定の直後)の末尾で校舎×週ぶんの実績を
`seo_metrics_snapshots`(校舎合計。表示回数/クリック数の校舎ページ・ブログ内訳、
Task status別生カウント、ギャップ充足率、公開記事数)と`seo_metrics_keyword_snapshots`
(キーワード別。GSC実績+`is_implemented_as_of_week`で実施群/未実施群の週次推移比較が可能)
の2テーブルへUPSERTする(既定dry-run、`--save`明示時のみ保存)。
ギャップ充足率の分母は「`status='approved'` かつ `task_type NOT IN ('monitor','exclude')`」、
分子は同条件かつ`implemented_at IS NOT NULL`(2026-07-27ユーザー承認の定義)。生カウントも
別途保存するため、後から分母定義を変えても再計算できる。
`seo_tasks.implemented_at`/`implementation_note`が実施済み管理の実体。`create_article`は
候補statusの`article_created`遷移に連動して自動セットする想定(未実装、今後の課題)、
`improve_school_page`等は`node scripts/seo_task_mark_implemented.js --task-id=<id>`で人間が
手動確定する(ダッシュボードのボタン化はフェーズ2)。時系列グラフ出力スクリプトは未実装
(10月頭に着手予定。上記2テーブルをSELECTするだけで済む設計にしてある)。
詳細は`docs/seo_metrics_snapshot_proposal_DRAFT.md`参照。

## あま本部校セルフ運用(branches.sync_mode、2026-07-27〜)

`branches.sync_mode`(既定`'scheduled'`)が`'draft_review'`の校舎(あま本部校)は、承認フローが
小幡校(`'scheduled'`)と異なる。`sync_draft_to_db.js`が石橋の`verified`判定を受け取った際、
`review_pending`のままダッシュボードの人間クリックを待たず、即座にWordPress下書き
(`status:'draft'`、`scripts/lib/post_sync.js`の`syncPostAsWordPressDraft()`経由で
`createDraftPost()`を呼ぶ)として同期し、ローカル`posts.status`を`wp_draft_synced`にする
(`scripts/lib/db.js`の`setWordPressDraftSynced()`)。WP同期に失敗した場合は`review_pending`
のまま残り、ダッシュボードの「承認」ボタン(`POST /api/posts/:id/approve`)が同じ経路への
手動リトライになる(`api-server.js`が`post.branch_id`から校舎の`sync_mode`を見て分岐する。
公開期限・入試ファクトチェックのブロックは自動"公開"の最終防衛ラインのため、下書き止まりの
この経路には適用しない)。
`sync_wordpress_status.js`は`wp_draft_synced`の記事も同期対象に含み
(`scripts/lib/wp_sync.js`の`decideDraftReviewSyncAction()`)、`draft`のまま(無警告)/
`publish`→`published`/`future`→`scheduled`/`trash`→`rejected`(意図的な運用結果として
無警告)/`not_found`(要警告)を判定する。ダッシュボードは`wp_draft_synced`の記事には
承認/差し戻しボタンを出さず、WP下書き確認を促す案内のみ表示する(形骸化した承認ボタンを
残さない設計判断)。
詳細・運用手順書は`docs/ama_honbu_self_operation_proposal_DRAFT.md`/
`docs/ama_honbu_yamaguchi_manual_DRAFT.md`参照。

## バッチ監視(失敗通知・デッドマンスイッチ、2026-07-27〜)

`daily_blog_all.sh`/`seo_weekly_analysis.sh`/`backup_db.sh`は、実行完了時に必ず
`scripts/record_heartbeat.js <name> [--failed]`で`logs/heartbeats/<name>.json`を更新する
(step単位の失敗有無に関わらず、スクリプト自体が最後まで走った時点で記録する)。
一部stepが失敗した場合は`scripts/notify_telegram.js`で即座にTelegram通知する
(既存の承認・投稿失敗通知と同じ`TELEGRAM_TOKEN`/`TELEGRAM_CHAT_ID`を再利用)。
`scripts/check_batch_heartbeats.js`は上記3バッチのheartbeatの新しさを監視するデッドマン
スイッチ本体で、cron自体が起動しない・処理が無応答になったまま終わらない、といった
「失敗イベント自体が発火しないケース」を検知する。監視対象バッチの実行cronとは別枠
(4時間おき、`0 */4 * * *`)で、この監視スクリプト自体を定期実行すること。異常時のみ1通に
まとめてTelegram通知し、正常時は無音(通知しない)。

### 反復アラートの深夜帯抑制・朝のまとめ通知・既知原因の自動提示(2026-08-08〜)

8/7・8/8にclaude CLIのOAuthセッションが失効し`daily_blog_all.sh`が2日連続で失敗した際、
アラート自体は正しく送信されていたが、同一文面が4時間おきに(深夜帯も含めて)繰り返し配信
され、反復に気づけないまま2日間記事が生成されなかった実インシデントを受けて改修した。

- **反復回数・連続日数の可視化**: `scripts/lib/heartbeat.js`の`recordFailureDetection()`が
  障害検知のたびに通算検知回数・連続検知日数(JST日付の異なり数)を`logs/heartbeats/
  <name>.incident.json`へ積み上げ、アラート文面に`🚨 2日連続・通算9回目`のように埋め込む
  (`readIncident()`/`clearIncident()`とセットで管理。正常化したら`check_batch_heartbeats.js`
  がインシデントを消す)。
- **既知原因パターンの自動検出**: `config/alert_known_causes.yaml`にpattern(正規表現)→
  remedy(対処法)を登録すると、`scripts/lib/known_causes.js`の`detectKnownCause()`が
  `logs/errors.json`の関連エラー(heartbeat完了時刻の前後1時間)を照合し、一致すれば
  `💡 対処: ...`をアラートへ直書きする。コード変更なしでYAML追記のみでパターンを増やせる。
  `daily_blog.sh`の`run_agent()`は失敗時、claudeの出力末尾(最大500文字)を
  `scripts/log_error.js`のdetailへ含めるよう変更済み(パターン照合対象の実文言を
  `logs/errors.json`に残すため)。
- **深夜帯(22:00〜06:00 JST)の反復抑制と朝のまとめ通知**: 新規障害の初回検知は時間帯を
  問わず即座に通知するが、同じ障害の反復検知は深夜帯のみ送信を抑制する
  (`isQuietHours()`/`shouldSendNow()`)。抑制された分は、`node scripts/check_batch_heartbeats.js
  --morning-summary`(深夜帯抑制を無視して必ず送信するモード)を**毎朝07:35に新規cronとして
  追加**すると、「🌅 未解決のままX時間経過」の形で必ず1本まとめて通知される
  (月曜07:30の週次ダイジェスト`seo_metrics_digest.js`と同時刻にすると片方の通知が埋もれる
  というレビュー指摘<2026-08-08>を受け、5分ずらしている)。**この07:35 cronエントリ
  (`35 7 * * * cd /home/ubuntu/juku_blog && ... node scripts/check_batch_heartbeats.js
  --morning-summary >> logs/heartbeat_check.log 2>&1`)は本番crontabへ未追加**
  (2026-08-08時点、コード実装・テストのみ完了。デプロイ時に追加すること)。
- **daily_blog_all.shの即時失敗通知にも同じ反復回数・対処法を共有する**: 06:00頃に届く
  `daily_blog_all.sh`自身のリトライ失敗通知(「日次記事生成(daily_blog_all.sh)で失敗した
  校舎があります」)は、check_batch_heartbeats.jsの次回チェックより先にユーザーが最初に
  目にする通知のため、こちらにも同じ通算検知回数・連続日数・既知原因の対処法を載せる
  (2026-08-08)。`scripts/notify_batch_failure.js <batch_name> "<本文>"`が
  `scripts/lib/heartbeat.js`の`recordFailureDetection()`・`scripts/lib/known_causes.js`の
  `detectKnownCause()`・`scripts/lib/alert_text.js`の`appendIncidentAndCause()`
  (check_batch_heartbeats.jsとの共有ロジック)を使って文面を組み立てて送信する。
  `daily_blog_all.sh`は従来の`notify_telegram.js`直接呼び出しからこちらへ置き換え済み。

## ダッシュボード

- `dashboard.html` + `scripts/api-server.js`(Express、既定ポート3013)
- 記事一覧・詳細プレビュー・承認/差し戻し・エピソード素材入力に加え、企画採用理由・採点・出典・
  類似度チェック・ファクトチェック・アイキャッチ・公開期限・WordPress同期状態を表示
- **承認ボタンを押す前に、予約予定日・期限超過有無・連続投稿警告をプレビュー表示**(`GET /api/posts/:id/schedule-preview`)
- 差し戻し時のメモは `data/rejected_notes.json` に反映され、翌日の智谷が参照する

## 複数校舎(branch-aware)対応 — Phase 1

記事生成パイプライン全体を複数校舎対応させる大規模対応のPhase 1(中核メカニズム構築)が完了している。
Phase 2(WordPress投稿の校舎別解決)・Phase 3(小幡校の実データ移行+あま本部の実設定投入)・
Phase 4(複数校舎の日次自動オーケストレーション)は未着手(下記「既知の未実装・制約」参照)。

- **ブランチコンテキスト解決の二系統**: ダッシュボードAPI(`api-server.js`)は明示的な`branchId`引数
  (`resolveBranchId(req)`で解決)、`daily_blog.sh`配下のCLI/エージェントは環境変数
  (`JUKU_BRANCH_ID`/`JUKU_BRANCH_SLUG`、`scripts/lib/branch_context.js`が読む)。優先順位:
  明示branchId引数 > 環境変数アンビエントコンテキスト > legacy(校舎コンテキスト無し、既存の唯一のbranch)。
- **`scripts/lib/config.js`**: `branches/<slug>/config/<file>.yaml`が存在すればそれを使い、無ければ
  共有の`config/<file>.yaml`にフォールバックする。**`juku.yaml`のみ例外**で、CLIパイプライン
  (`daily_blog.sh`経由)は校舎別`juku.yaml`が無いとハードエラーで停止する(暗黙フォールバックによる
  誤生成事故を防ぐため)。ダッシュボードAPI経由は共有configへフォールバックした上で
  `isSharedFallback: true`をレスポンスに含める(`isEarliestBranch()`により、最古のbranch自身が
  共有configを使う場合はフォールバック扱いにしない)。
- **`daily_blog.sh`**: 第1引数に校舎の`slug`(`branches.slug`)を指定すると、`scripts/resolve_branch.js`
  でIDを解決し、各エージェントへの指示文の先頭に`【校舎コンテキスト】config=<dir> data=<dir>`を注入する。
  引数省略時は従来通り(共有config/data、単一校舎)。
- **5エージェント**(`researcher-local`/`planner-blog-btoc`/`writer-blog-btoc`/`editor-btoc`/`verifier-local`)
  の`.md`冒頭に、指示文の`【校舎コンテキスト】`行を見てパスを読み替えるルールを追加済み
  (本文中の個別パス記述は書き換えていない)。
- **ダッシュボードのテーマカレンダー**: `GET /api/theme-calendar`が`isSharedFallback`を返し、
  校舎別テーマ設定がまだ無い校舎を選択した際は「参考表示」の警告バナーを表示する。

## テスト分離の既知課題(改修バックログ、2026-08-08)

`config/juku.yaml`の`search_console_enabled`を本番同期した際、共有configの実際の値に
依存していたテストが実際にGoogle Search Console APIへ本物のネットワーク接続をしてしまう
実インシデントが発生した。この反省を受けた`test/`配下全体の監査結果・優先順位付き改修案は
`docs/test_isolation_audit.md`を参照(優先順位: 1.テスト実行時の外向き通信遮断ガード →
2.`seo_weekly_analysis.test.js`の実クロール有無の確認 → 3.`seasonal_topics.test.js`の
件数ピン留めを構造検証へ)。未着手のバックログであり、当面は個別修正のみで対応する。

## 診断・運用コマンド

```bash
npm test                              # node:test。単体・結合テスト一式
node scripts/dry_run.js [YYYY-MM-DD]  # WordPress投稿・DB登録を一切行わず全項目を確認
node scripts/sync_wordpress_status.js # WordPress公開状態を手動同期(通常はcronが毎朝実行)
node scripts/check_similarity.js <draft>  # 類似度チェックを手動実行
node scripts/check_citations.js <draft>   # 出典ID検証を手動実行
node scripts/fetch_exam_research.js YYYY-MM-DD  # 愛知県高校入試情報の取得を手動実行(features.aichi_exam_research有効時のみ動作)
node scripts/check_exam_facts.js <draft>  # 愛知県高校入試ファクトの年度整合性等を手動検証
bash scripts/seo_weekly_analysis.sh        # 競合キーワード分析の週次バッチを手動実行(詳細はdocs/seo_operations.md)
node scripts/seo_candidates_list.js        # 競合キーワード候補の一覧をCLIで確認
node scripts/seo_gsc_sync.js [--start=YYYY-MM-DD --end=YYYY-MM-DD] [--dry-run]  # Search Console実績の取得(features.competitor_keyword_analysis.search_console_enabled有効時のみ動作)
node scripts/seo_gsc_reset.js --dry-run|--confirm  # 開発用: seo_gsc_queriesのみ安全に削除(posts・他のSEOテーブルは無変更)
node scripts/seo_task_generate.js [--dry-run]  # SEO Task生成(features.growth_director有効時のみ動作)
node scripts/seo_metrics_snapshot_generate.js --week=YYYY-MM-DD [--branch-id=<id>] [--baseline] [--dry-run|--save]  # SEO効果測定の週次スナップショット(seo_weekly_analysis.shの末尾で自動実行。既定dry-run)
node scripts/seo_task_mark_implemented.js --task-id=<id> [--note=<text>] [--unset]  # improve_school_page等、自動検知できないTaskの実施済みを手動確定
node scripts/check_batch_heartbeats.js  # バッチ監視(デッドマンスイッチ)を手動実行。異常時のみTelegram通知
node scripts/check_batch_heartbeats.js --morning-summary  # 朝のまとめ通知モード(深夜帯抑制を無視して未解決分を必ず送信。本番では毎朝07:35に別cronで実行する想定)
```

## 運用パラメータ(`config/juku.yaml` の `generation`)

- 差し戻し上限: `max_retry`(既定2)
- 1日の生成本数: `daily_count`(既定1)
- 生成バッチ起動時刻: `run_time`(既定05:00、予約投稿時刻にも使用)
- 類似度チェック閾値: `duplicate_threshold`(title/headings/body)
- 連続投稿の警告閾値: `max_same_category_streak`(既定2)/`max_same_audience_streak`(既定3)。**ブロックはせず警告のみ**

## 既知の未実装・制約

- **バッチ監視の既知原因照合窓が実行時間の長い工程では外れうる(2026-08-08発見、未実装)**:
  `check_batch_heartbeats.js`の`collectDiagnosticText()`は、`logs/heartbeats/<name>.json`の
  `completedAt`(=daily_blog_all.shの最終リトライが確定した時刻)の前後1時間で
  `logs/errors.json`を検索して既知原因パターン照合する設計。校舎数が増えて実行時間が延び、
  「初回試行の失敗」から「完了(=リトライも失敗して確定)」までが1時間を超えると、
  初回試行時に記録されたエラーのdetailが照合窓から外れ、既知原因の対処法が載らなくなる恐れが
  ある。対処案: heartbeatに`startedAt`(実行開始時刻)も記録し、`startedAt`〜`completedAt`の
  区間をそのまま照合窓にする(無ければ現行の固定窓にフォールバック)。実装は次回。
- 複数校舎対応はPhase 1(中核メカニズム)のみ完了。WordPress投稿の校舎別解決(Phase 2)・
  小幡校の実データ移行とあま本部の実設定投入(Phase 3)・複数校舎の日次自動オーケストレーション
  `daily_blog_all.sh`(Phase 4)は未着手。現状`branches/<slug>/config/`を持つ校舎は存在せず、
  校舎別`daily_blog.sh <slug>`実行は本番未使用
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
- ローカル開発環境には`.env`が存在しないため、実際のGoogle Search Console接続・WordPress投稿は
  未検証(コードはユニットテストのfake providerで検証済み)。本番導入前に`docs/search_console_setup.md`
  の手順で実際に1回動作確認することを推奨
- 校舎ページ登録はダッシュボードUI未実装で`config/school_pages.yaml`直接編集のみ。ページ本文の
  取得・タイトル/H1分析は未実装(Sprint 2時点ではURLと対象地域の対応のみを保持)
