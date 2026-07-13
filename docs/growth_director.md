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
