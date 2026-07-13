# AI Growth Director(Sprint 1: 基盤)

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
4. school_page系テンプレート
     既存校舎ページあり → improve_school_page
     無ければ           → create_article
5. 既存記事に強く一致              → improve_existing_article
6. 関連記事あり(完全一致ではない)   → add_internal_links
7. gap_type in (missing/untapped/content_gap) → create_article
8. それ以外                        → monitor
```

**既知の制約(Sprint 1時点)**:
- 「料金」等のFAQ語は現在の複合キーワード抽出(11テンプレート)の対象になっていないため、
  実データでは`seo_keyword_candidates`にそもそも生成されない。URL Allocator自体は
  判定可能だが、実際に発生させるにはキーワード抽出辞書の拡張(Sprint 2以降)が必要。
- `add_internal_links`(関連記事あり)の判定材料(`relatedPostId`)は未実装で、
  `seo_task_generate.js`は常にnullを渡す。関数としては判定可能。

## Opportunity Score(0〜100点、priority_scoreとは独立)

`config/juku.yaml`の`seo.growth_director.opportunity_score_weights`で配点を調整できる
(既定: 競合採用数20/地域一致20/検索意図20/自社カバー状況20/データ確度10/工数10)。
`scripts/lib/seo/opportunity_score.js`が数式のみで算出する(AIには数値を決めさせない)。

工数(`estimated_effort_minutes`)は`config/juku.yaml`の
`seo.growth_director.effort_minutes_by_task_type`から算出する(task_type別の既定値、
ハードコード禁止)。

## ダッシュボード

「Growth Director」タブ(既存の「競合キーワード分析」タブとは別)。★の数は
Opportunity Scoreから換算(80-100点=★5〜20点未満=★1)。候補の詳細画面でOpportunity Score
の内訳・見積り工数・理由を確認できる。承認/除外は`seo_tasks.status`
(proposed/approved/rejected)を変更するのみで、記事生成・WordPress投稿には一切接続しない。

## 今回実装しなかったもの(Sprint 2以降)

- Search Console改善連携の強化
- 学校カレンダー・MEO・保護者質問DB・自己学習
- WordPress自動更新・AIによる文章生成・ドラフト生成
- Task承認後の自動実行(in_progress/doneステータスへの自動遷移)
- FAQ語・関連記事(relatedPostId)判定の実データ対応
