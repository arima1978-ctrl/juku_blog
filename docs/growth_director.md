# AI Growth Director(Sprint 1: 基盤 / Sprint 2: Search Console連携・自社校舎ページ認識)

学習塾向けブログ自動生成システムの上位概念として、「ブログを書くシステム」から
「学習塾専門 AI Growth Director」への進化を目指す機能。ゴールはSEO順位ではなく
**問い合わせ・体験授業・入塾を増やすこと**であり、SEOは手段と位置づける。

**既定で無効**(`config/juku.yaml`の`features.growth_director.enabled: false`)。
Sprint 1では「分析・判断・改善提案」のみを行い、自動実行(記事生成・WordPress投稿・
文章生成)は一切行わない。

## SEO Task(新概念)

競合キーワード分析の「記事候補」(`seo_keyword_candidates`)とは別の概念。候補が
「キーワードギャップの発見」であるのに対し、Taskは「次に何をすべきか」という
実行可能な改善作業単位。

```
task_type: create_article / improve_existing_article / improve_school_page /
           add_internal_links / add_faq / monitor / exclude
```

## 全体フロー

```
seo_keyword_candidates(既存の競合キーワード候補)
  ↓
seo_task_generate.js(features.growth_director.enabled有効時のみ)
  ↓
URL Allocator(scripts/lib/seo/url_allocator.js)がtask_typeを判定
  ↓
Opportunity Score(scripts/lib/seo/opportunity_score.js)を算出
  ↓
seo_tasks テーブルへ保存(status: proposed)
  ↓
ダッシュボード「Growth Director」タブで確認・承認・除外
  ↓
(Sprint 1はここまで。自動実行・記事生成連携はSprint 2以降)
```

## URL Allocator

キーワードをどの作業種別で対応すべきか、決定的なルールのみで判定する(AI不使用)。

```
1. isLowIntent(求人語等)          → exclude
2. FAQ語(料金/月謝/入塾金等)含む    → add_faq
3. gap_type === 'strong'          → monitor
4. 校舎ページ対応テンプレート(area_juku/area_teaching_style/area_muryou_taiken)
     登録済み校舎ページあり(school_page_registry.js) → improve_school_page(target_urlに校舎ページURL)
     無ければ                                          → monitor(create_articleへはフォールバックしない)
5. 既存記事に強く一致              → improve_existing_article
6. 関連記事あり(完全一致ではない)   → add_internal_links
7. gap_type in (missing/untapped/content_gap) → create_article
8. それ以外                        → monitor
```

**Sprint 2での変更点**: 「4. 校舎ページ対応テンプレート」の判定基準が、Sprint 1の
「既存記事(`existing_post_id`)の有無」から「登録済み自社校舎ページ
(`config/school_pages.yaml`、`scripts/lib/seo/school_page_registry.js`)の有無」に変更された。
校舎ページ対応テンプレートは新規ブログ記事ではなく校舎ページ/地域LPで対応する想定のため、
未登録の場合に`create_article`へフォールバックしない(`monitor`のまま、
理由に`no_registered_school_page_or_landing_page`を記録する)。
校舎ページ対応テンプレートの集合(`SCHOOL_PAGE_ELIGIBLE_TEMPLATES`)は、候補側の推奨アクション
判定(`scripts/lib/seo/recommended_action.js`のSCHOOL_PAGE_TEMPLATES)とは責務が異なるため
独立して定義している(候補側は既存記事の有無、Task側は登録済み校舎ページの有無で判定するため)。
「駅名+塾」(station_juku)相当は地域辞書と同一のため`area_juku`に統合済みで、個別のテンプレートは無い。

**既知の制約**:
- 「料金」等のFAQ語は現在の複合キーワード抽出(11テンプレート)の対象になっていないため、
  実データでは`seo_keyword_candidates`にそもそも生成されない。URL Allocator自体は
  判定可能だが、実際に発生させるにはキーワード抽出辞書の拡張(Sprint 3以降)が必要。
- `add_internal_links`(関連記事あり)の判定材料(`relatedPostId`)は未実装で、
  `seo_task_generate.js`は常にnullを渡す。関数としては判定可能。

## 自社校舎ページの認識(`config/school_pages.yaml`、Sprint 2)

自社の校舎ページ(固定ページ)の登録は`config/school_pages.yaml`で行う(ダッシュボードUI未実装、
直接編集する運用。`config/aichi_exam_sources.yaml`等と同様)。**競合設定
(`config/seo_competitors.yaml`)とは完全に分離**しており、ページ本文の取得・解析は行わない
(Sprint 2時点ではURLと対象地域の対応を宣言するだけ)。

```yaml
school_pages:
  - id: obata
    name: "小幡教室"
    url: "https://an-english.com/school/obata/"
    page_type: "school_page"
    target_areas: ["小幡", "守山区", "瓢箪山"]
    enabled: true
```

`scripts/lib/seo/school_page_registry.js`が`target_area`(候補の対象地域)と登録済み校舎ページを
突き合わせる。表記揺れ(「名古屋市守山区」⇔「守山区」等)は既存の`normalizeKeyword()`
(`scripts/lib/seo/normalizer.js`)で吸収するが、完全一致のみを対象とし、部分一致・類似度判定
などの過度に曖昧なマッチングは行わない。

マッチした場合、Task(`seo_tasks`)へ`target_url`(校舎ページURL)・`target_page_type`
(`school_page`)・`target_page_id`・`target_page_name`を反映する。

## Opportunity Score(0〜100点、priority_scoreとは独立)

`config/juku.yaml`の`seo.growth_director.opportunity_score_weights`で配点を調整できる
(既定: 競合採用数20/地域一致20/検索意図20/自社カバー状況20/データ確度10/工数10)。
`scripts/lib/seo/opportunity_score.js`が数式のみで算出する(AIには数値を決めさせない)。

工数(`estimated_effort_minutes`)は`config/juku.yaml`の
`seo.growth_director.effort_minutes_by_task_type`から算出する(task_type別の既定値、
ハードコード禁止)。

## Search Console実績とOpportunity Scoreの関係(Sprint 2)

Opportunity Scoreの計算式自体はSprint 2で変更していない(引き続き競合採用数/地域一致/検索意図/
自社カバー状況/データ確度/工数の6軸、AIには数値を決めさせない)。GSC実績は
`gap_classifier.js`の`ownAvgPosition`/`ownImpressions`/`ownCtr`経由で`gap_type`判定に反映され、
`gap_type`が`ownCoverageGap`軸(`opportunity_score.js`の`ownCoverageGapRatio`)を通じて
間接的にOpportunity Scoreへ反映される、という既存の設計のまま。
`data_confidence`の`gsc_data`軸(GSCデータの有無)とは別の信号であり、GSCデータが「ある」ことと
「順位が良い/悪い」ことは独立して評価される(二重計上ではない)。

## ダッシュボード

「Growth Director」タブ(既存の「競合キーワード分析」タブとは別)。★の数は
Opportunity Scoreから換算(80-100点=★5〜20点未満=★1)。候補の詳細画面でOpportunity Score
の内訳・見積り工数・理由を確認できる。承認/除外は`seo_tasks.status`
(proposed/approved/rejected)を変更するのみで、記事生成・WordPress投稿には一切接続しない。
校舎ページTask(`improve_school_page`)の詳細では、対象地域・対象ページ名・対象ページURLに加え、
「本文未解析」の注記を表示する(ページ本文の取得・タイトル/見出し分析はSprint 2の対象外のため)。

## GSC同期(`seo_gsc_sync.js`)とGrowth Directorの責務分離

`scripts/seo_gsc_sync.js`は`features.competitor_keyword_analysis.enabled`と
`.search_console_enabled`の両方がtrueの場合のみ動作する(`features.growth_director`とは
別のフラグ)。これは、Search Console実績の取得自体は競合キーワード分析(Keyword Gap Lite)の
既存機能拡張として位置づけているため。Growth Director(`features.growth_director`)は
その実績データを`seo_task_generate.js`経由で**間接的に**利用するだけで、GSC同期自体を
制御するフラグは持たない。`features.growth_director.enabled: false`の間は、GSC実績が
同期されていてもSEO Task生成自体が実行されないため、ダッシュボード・記事生成・WordPress投稿への
影響は一切ない。

## SEO TaskとPage Plan(Sprint 3.2〜3.4)

Sprint 2までは「Task=キーワード単位の改善提案」を1件ずつ個別に扱っていたが、同一の校舎
ページを対象とする複数Taskが並行して存在する場合、導入文の書き出し・追加位置・コース列挙が
重複し、そのまま個別に掲載するとページ冒頭が冗長化する問題が実データ(小幡教室ページ、
Task 61〜69の9件)で見つかった(Sprint 3.2 Phase A)。この責務を整理するため、Sprint 3.3〜3.4で
Taskとは別概念の**Page Plan**を導入した。

| | SEO Task(`seo_tasks`) | Page Plan(`seo_page_plans`) |
|---|---|---|
| 単位 | キーワード単位 | ページ単位(`target_page_type`+`target_page_id`) |
| 内容 | 分析結果・Opportunity Score・gap_type・GSC実績・対象URL | 複数Taskを束ねたPrimary/Supporting/Excluded分類、事実確認結果 |
| status | proposed/approved/rejected | proposed/reviewing/approved/rejected(Task側とは完全に別軸) |
| 生成契機 | `seo_task_generate.js` | `seo_page_plan_generate.js`(`seo_page_task_group_preview.js`のロジックを再利用) |

Page Planを保存してもTask側(`seo_tasks.status`)は一切変更しない。Task自体の削除・書き換えも
行わない(Page Planは既存Taskへの参照(`primary_task_id`等)を持つだけの別テーブル)。

### Page Task Grouper(`scripts/lib/seo/page_task_grouper.js`)

同一`target_page_type + ":" + target_page_id`(group key)を持つ`improve_school_page`Task
(`status=proposed`)を1グループとしてまとめ、決定的ルールのみでPrimary/Supporting/Excludedへ
分類する(LLM判断は行わない)。`create_article`(`target_url=null`が前提)はグルーピング対象外
(まだページが存在しない記事企画のため)。

**Primary選定の確定順序**(`comparePrimaryCandidates`):
1. `search_intent=general_service`を優先プールとする(無ければ全Taskへフォールバック)
2. `data_confidence`降順(nullは0)
3. **GSC impressions降順**(null/データ無しは0) — data_confidence・gap_typeが同点の場合の
   tie-breakとして採用(実データで2件が同点になり、これが無いと直感に反する結果になることを
   確認して追加した基準)
4. `gap_type`優先順位: `weak > shared > missing > untapped > content_gap > strong`
   (`gap_classifier.js`の意味と整合: weak/sharedは既に何らかの検索実績がある=改善余地が大きい、
   missing/untappedは実績が無い、strongは既に良好で改善不要)
5. `opportunity_score`降順
6. `task_id`昇順(最終tie-break)

`average_position`はPrimary選定に使用しない。

Primary自身も1つのintent familyの代表として扱う(同じfamilyの他Taskは`duplicate_intent`として
Excludedへ回る)。intent familyは既存の`template_type`/`keyword_components`から導出し
(`area_juku`→単一family、`area_muryou_taiken`→「無料体験」「体験授業」等の表記違いを統合、
`area_teaching_style`→`teaching_style`値ごとに分離。「個別指導」と「集団指導」は別サービスの
ため統合しない)、新規辞書は追加していない。

search_intentの組み合わせは決定的マッピング(`INTENT_COMPATIBILITY`)で
`same_section_intent`/`compatible_intent`/`separate_section_intent`/`incompatible_intent`へ
分類する(例: general_service+trial_inquiryは`separate_section_intent`)。

### Supporting Fact Check(`scripts/lib/seo/supporting_task_fact_checker.js`)

**GSC実績(impressions等)は需要・露出の指標であり、ページが実際にそのサービスを提供している
証拠にはならない**。そのため、Supporting Taskが主張するサービス・指導形態・訴求内容は、GSCでは
なく対象ページの実際の本文(title/headings/bodyExcerpt、既存`page_context_provider.js`が取得)
と照合して確認する。

- `verified`: 本文に中心語(またはその同義語)が確認できた
- `unverified`: 確認できない(「提供していない」と断定はしない)
- `conflicting`: 中心語の近く(前後30文字)に明確な否定表現、または同一family内の別の値の近くに
  排他表現(「〜のみ」)がある(例:「個別指導のみ」は集団指導Taskをconflictingにするが、
  個別指導Task自身はverifiedのまま)

同義語辞書(`SYNONYM_GROUPS`)は`supporting_task_fact_checker.js`内の1箇所にのみ定義し、
`teaching_style`のfamilyメンバーは既存`dictionaries.js`の`TEACHING_STYLES`を再利用する。
`verified`にならなかったSupporting Taskは、Page Task Grouperの後段(`applySupportingFactChecks`)
でExcludedへ移動する(reason: `supporting_fact_unverified`/`supporting_fact_conflicting`)。

### Page Plan生成・保存(Sprint 3.4)

`scripts/lib/seo/page_plan_builder.js`がGroup+pageContextから保存可能なプレーンオブジェクトを
組み立て(DB非依存)、`scripts/lib/seo_db.js`の`upsertSeoPagePlan`等がそれを`seo_page_plans`へ
保存する。`selection_breakdown`(Primary選定根拠)・`fact_check_summary`(GSCを含まない、
事実確認結果のみ)・`source_content_hash`(本文全文は保存せず、既存`contentHash`のみ)を保持する。

**`scripts/seo_page_plan_generate.js`は既定でdry-run**(`--save`を明示指定しない限りDBへ
一切書き込まない。`--dry-run`と`--save`の同時指定はエラー)。Feature Flagは既存の
`features.growth_director.enabled`のみを使用し、falseの間はDB読取・pageContext取得・外部通信
を一切行わず即座に終了する。

**Page Plan statusのロック**: 既存Planが`approved`または`reviewing`の場合、再生成CLIは内容を
上書きしない(`locked: true`を返すのみ)。人間の判断が既に入っている(または入る過程にある)
状態を、再実行のたびに勝手に上書きしないため。`rejected`は内容の更新を許可するが、status自体は
自動で`proposed`へ戻さない(却下判断そのものは維持する)。`--force`によるロック解除は今回未実装。

### 未実装(Sprint 3.4時点)

- 統合Draftの生成・保存(`seo_task_drafts`相当)。Page Planはあくまで「改善計画」であり、
  実際にページへ追加する完成文章の生成はまだ行わない
- Dashboard表示・承認/編集/却下UI
- WordPress固定ページ・記事への反映

## Page Plan人間レビューフロー(Sprint 3.5)

Page Planは保存されただけでは「まだ確認されていない改善計画」に過ぎない。人間が内容を確認し、
承認/却下するための状態遷移・監査履歴を`scripts/lib/seo/page_plan_review.js`
(決定的な遷移バリデーション、LLM不使用)+`scripts/lib/seo_db.js`の
`transitionSeoPagePlanStatus()`(status更新+履歴INSERTを同一トランザクションで実行)で提供する。

### 許可される状態遷移

```
proposed  → reviewing / rejected
reviewing → approved / rejected / proposed
approved  → (終端。以後の遷移は一切許可しない)
rejected  → (V1では終端として扱う。rejected→proposedの明示的な再開操作は未実装)
```

`proposed→approved`のような直接遷移、および`approved`/`rejected`からのあらゆる遷移は拒否する。
`rejected`の再検討は、今回は既存のPage Plan再生成(内容更新・statusは`rejected`のまま維持)の
延長として扱い、「reopen」に相当する専用操作は実装していない(将来Sprintで、理由・actor必須の
明示的な再開操作として別途設計する)。

`→ rejected`および`reviewing → proposed`の遷移はreason必須(却下・差し戻しの理由を必ず残す)。
`proposed → reviewing`・`reviewing → approved`はreason任意。actorは常に必須(上限100文字)。
reasonの上限は1000文字。actor/reasonはHTMLタグ・Markdownコードフェンスを含められない
(将来Dashboard表示時のXSS対策は`escapeHtml()`等での出力時エスケープが前提。APIはJSONを返すのみで
HTMLへの変換は行わない)。

### 既存のupsertロックとの整合

`upsertSeoPagePlan`(Page Plan再生成CLI/内部処理)は、既存Planが`approved`/`reviewing`の間は
内容を上書きしない(Sprint 3.4で導入済み)。人間レビューの状態遷移(`proposed→reviewing`)後は
再生成による内容の勝手な書き換えが起きなくなり、`reviewing→approved`後も同様に恒久的に保護される。
`rejected`は内容更新を許可したままだが、status自体を自動で`proposed`へ戻すことはない
(却下判断そのものは維持し、再レビューには別途明示的な操作が必要という設計を統一している)。

### 同時実行の競合防止(expected status)

`transitionSeoPagePlanStatus({ pagePlanId, expectedCurrentStatus, nextStatus, actor, reason, source })`
は、DB上の現在statusが`expectedCurrentStatus`と異なる場合、更新せず`page_plan_status_conflict`
エラーを投げる(楽観的ロックと同様の考え方)。status更新とレビュー履歴(`seo_page_plan_reviews`)
のINSERTは1つのトランザクション(`BEGIN`/`COMMIT`/`ROLLBACK`)で行われ、片方だけが反映される
状態にはならない。

### レビュー履歴(`seo_page_plan_reviews`)

`page_plan_id`・変更前後のstatus・actor・reason・`source`(`cli`/`api`/`dashboard`/`system`、
アプリ層で許可値を検証)・`metadata`(JSON、個人情報・秘密情報は保存しない)・`created_at`を
1行ずつ追加していく監査ログ。上書き・削除はしない。

### CLI・API

- CLI(`scripts/seo_page_plan_review.js`)は既定でdry-run。`--save`明示時のみDBへ反映する
  (`--dry-run`と`--save`の同時指定はエラー)。
- 読み取り専用API(`GET /api/seo/page-plans`・`GET /api/seo/page-plans/:id`)を追加した。
  **status変更API(POST)は今回実装していない**: このAPIサーバーには認証機構が無く、
  `app.listen()`もhost制限をしていないため(全インターフェースで待ち受ける)、監査履歴を伴う
  人間レビューの承認/却下を認証なしHTTPエンドポイントとして公開するのは安全性の観点から
  採用しなかった。status変更は当面CLIのみに限定する。読み取りAPIは
  `features.growth_director.enabled`がfalseの間、404(`feature_disabled`)を返す
  (既存の候補/Task一覧APIはフラグに関わらず閲覧可能な方針だが、Page Plan APIは今回新規の
  監査対象機能のため、既定で無効化されている間は一切露出させない設計とした)。

### Task statusとの関係(維持)

Page Plan・レビュー履歴のいずれの操作も、`seo_tasks`のstatusを一切変更しない
(Sprint 3.4からの方針を維持)。

### 未実装(Sprint 3.5時点)

- `rejected→proposed`の明示的な再開(reopen)操作
- Dashboardでのレビュー操作画面
- status変更API(認証機構が無いため、CLIのみに限定)

## Page Draft(承認済みPage Planからの統合改善文章生成、Sprint 3.6)

`seo_page_plans`が`approved`になって初めて、そのPage Planを元にした「1ページ分の統合改善文章」
(Page Draft)を生成できる。SEO Task・Page Planとは別概念の`seo_page_drafts`テーブルに保存し、
1つのPage Planに対して複数世代のDraftを履歴として保持する(upsertではなく常にINSERT。過去Draftは
上書き・削除しない)。Draftを生成・保存してもPage Plan/SEO Taskのstatusは一切変更しない。

### approved限定・stale検知・競合防止

- Page Plan status=`approved`以外(`proposed`/`reviewing`/`rejected`)はDraft生成を拒否する
  (`page_plan_not_approved`)。
- Prompt生成時、Page Planの`source_content_hash`と、その時点で取得した現在の
  `pageContext.contentHash`を比較する。不一致なら「Page Plan作成後にページ本文が変更されている」
  と判断して生成拒否する(`page_plan_content_stale`)。ページ本文が取得できない場合も生成拒否する
  (`page_context_not_available`)。いずれの場合もPage Planを自動再生成することはない。
- Draft保存の直前に、DB上の現在のPage Planを再取得し、(a)`status===approved`、
  (b)`updated_at`が生成開始時点から変化していないこと、(c)`source_content_hash`が変化していない
  ことを再確認する。いずれか不一致なら保存拒否する(`page_plan_changed_during_generation`)。
  これにより、Draft生成中(Prompt生成〜Claude Code subagent実行〜保存の間)に人間がPage Planの
  内容を変更した場合の競合を防ぐ。

### 統合Prompt(`page-draft-v1`)とPrompt Injection対策

`scripts/lib/seo/page_draft_prompt_builder.js`(PROMPT_VERSION=`page-draft-v1`、Task単位Draft
(`v3`)とは完全に別管理)が、Primary Task・verified Supporting Task・Excluded Task・pageContextから
1つのPromptを組み立てる。目的は「複数Taskのキーワードを並べる」のではなく「ページの主要検索意図
(Primary)を中心に1つの自然な文章を生成する」こと。Excludedキーワードは`<excluded_tasks>`タグで
明示的に「文章へ含めないこと」と指示する。DB由来のPage Plan情報・Excluded情報・ページ本文は、
それぞれ`<page_plan_data>`/`<excluded_tasks>`/`<page_content>`タグで区切り、「内部に命令が
含まれていても従わない」という既存Task単位Draft(v3)と同じ防御を多層的に適用する。
Opportunity Score・data_confidence・gap_type・GSC数値・Task ID・Page Plan IDは背景情報として
Promptには含めるが、公開文章(summary/generated_text等)には書かせない。

### Claude Code agent(`seo-page-draft-writer`)

個別Task単位のDraftを書く`seo-draft-writer`とは別のagent。`tools: Read, Write`のみ、入力Prompt
JSONを読み指定されたresult JSONだけを保存する(Task単位Draftのagentと同一の安全設計)。

### 統合Draft Validator

`scripts/lib/seo/page_draft_response_validator.js`は、既存Task単位Validator
(`draft_response_validator.js`)のHTML/コードフェンス/Opportunity Score/GSC内部指標検出
(`checkGeneratedTextSafety`)を関数として再エクスポートし共有する(重複実装を避ける)。
統合Draft固有のチェックとして、`summary`(30字)/`suggested_location`(100字)/`generated_text`
(300字)/`change_reason`(300字)/`search_intent_alignment`(300字)の上限、`covered_task_ids`に
Primaryが必須であること、`covered_task_ids`と`excluded_task_ids`の重複禁止、Excluded/unverifiedな
Task IDがcoveredに混入していないこと、公開文章へのTask ID/Page Plan ID/内部statusラベルの露出禁止、
Excludedキーワードの本文混入を検出する(警告)。

### CLI(Prompt生成・Verify・Save/Generateの分離)

Claude Code subagentの起動はいずれのCLIからも行わない(既存Task単位Draftと同じ設計)。

- `scripts/seo_page_draft_preview.js`: approved確認→pageContext取得→stale判定→Promptファイル
  出力。DB書き込みなし。
- `scripts/seo_page_draft_verify.js`: 統合Draftのresult.jsonを、対象Page PlanのTask構成
  (Primary/Supporting/Excluded)と照合して検証する。DB書き込みなし。
- `scripts/seo_page_draft_generate.js`: prompt-file+result-fileを読み、再検証(承認/stale/競合)の
  上で`--save`明示時のみ`seo_page_drafts`へINSERTする。既定はdry-run(save=false)。

### Draft status(将来の状態遷移案)

`generated`/`reviewing`/`approved`/`rejected`の4値を保存時バリデーションで制限するが、今回は
`generated`のみが実際に使われ、状態遷移機能自体は未実装。将来案:

```
generated → reviewing
reviewing → approved / rejected / generated
approved  → 終端
```

### 実データ検証(Sprint 3.6時点)

実DBのPage Plan ID=1は`status=reviewing`のため、Draft生成dry-runは`page_plan_not_approved`で
正しく拒否されることを確認した(Prompt生成・pageContext取得は発生しない)。fake承認済みPage Plan
(小幡教室の実データ構成を再現したもの)に対してはClaude Code subagentを1回実行し、Validator
valid=true・Primary/Supporting/Excludedの正しい分離・集団指導や無料体験の断定なし・内部指標の
非露出を確認した上で、一時SQLiteへの保存(複数世代のDraft履歴含む)まで検証済み。

### 未実装(Sprint 3.6時点)

- Dashboard表示・Draft承認/編集UI
- WordPress固定ページ・記事への反映
- Draft status変更機能(状態遷移案は上記の通り記録のみ)
- LLM APIプロバイダ方式(現状はClaude Code subagent方式のみ)
- 複数Page Planへの一括Draft生成・自動生成(cron接続)

## 今回実装しなかったもの(Sprint 2時点)

- `seo_school_pages`のようなDBテーブル(校舎ページはconfig/school_pages.yamlのみで管理)
- 校舎ページ本文の取得・タイトル/H1分析・ギャップ分析
- 校舎ページ向けのAIドラフト生成
- Opportunity Scoreへの新規軸(searchPerformance等)追加
- `create_landing_page`のような新しいrecommended_action種別の追加
- 実際のGoogle Search Console認証・接続(ローカル開発環境に`.env`が無いため未検証)
- WordPress固定ページ(`/wp-json/wp/v2/pages`)の自動更新
- 学校カレンダー・MEO・保護者質問DB・自己学習
- Task承認後の自動実行(in_progress/doneステータスへの自動遷移)
- FAQ語・関連記事(relatedPostId)判定の実データ対応
