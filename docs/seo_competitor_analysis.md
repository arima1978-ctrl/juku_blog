# 競合キーワード分析 Keyword Gap Lite

近隣の競合塾が扱っている検索テーマと、自社サイトが実際にGoogle検索で表示されているキーワードを
比較し、次に作成・改善すべき記事候補をダッシュボードへ提案する機能。

**既定で無効**(`config/juku.yaml`の`features.competitor_keyword_analysis.enabled: false`)。
無効の間はどのスクリプトもseo_*テーブル・外部サイトへ一切アクセスしない。

## 全体フロー

```
週次バッチ(scripts/seo_weekly_analysis.sh、daily_blog.shとは別cron)
  ↓
seo_competitor_crawl.js   競合サイト取得(sitemap優先、SSRF対策・robots.txt尊重・レート制限)
  ↓
seo_page_analyze.js       title/見出し/本文から辞書+重み付けでキーワード候補抽出
  ↓
(別途・任意) seo_gsc_sync.js          Search Console実績取得(日次別cron推奨)
(別途・任意) seo_keyword_metrics_import.js / seo_serp_import.js  CSV取込(手動実行)
  ↓
seo_gap_calculate.js      自社記事(posts)・GSC・検索需要・順位データを突き合わせ
                          Keyword Gap判定+優先度スコアを算出、seo_keyword_candidatesを更新
  ↓
ダッシュボード「競合キーワード分析」タブ  人間が確認・承認・除外
  ↓
(use_for_topic_selection: true の場合のみ)
scripts/seo_topic_candidates_export.js が承認済み候補を data/seo_candidates/YYYY-MM-DD.json へ出力
  ↓
智谷(planner-blog-btoc)が既存の企画ロジックの1候補として考慮(季節テーマ優先は維持)
  ↓
sync_draft_to_db.js が記事生成完了を検知し、対象候補を approved → article_created へ遷移
```

## 競合塾の登録

`config/seo_competitors.yaml`に登録する(管理画面からの登録は未実装。YAML直接編集、
`config/aichi_exam_sources.yaml`と同じ運用)。

```yaml
competitors:
  - id: example_competitor
    name: "サンプル塾"
    domain: "example-juku.com"
    sitemap_url: "https://example-juku.com/sitemap.xml"
    competitor_type: local   # local/major_chain/exam_specialist/subject_specialist/information_media/other
    crawl_enabled: true
    max_pages: 100
```

未登録のドメインは一切取得されない(許可リスト方式)。安全のため、実際に内容を確認するまで
`crawl_enabled: true`の競合は追加しない運用を推奨する。

## Keyword Gap判定

`scripts/lib/seo/gap_classifier.js`が以下の6分類を判定する。

| gap_type | 意味 |
|---|---|
| missing | 競合が扱っているが自社に関連コンテンツ・検索実績が無い |
| weak | 自社にもあるが順位11位以下/競合に劣後/表示はあるがCTRが低い/内容が競合より薄い |
| untapped | 一部の競合だけが扱っており自社には無い |
| shared | 自社・競合ともに扱っている(明確な優劣なし) |
| strong | 自社が競合より上位、または自社の実績が十分に強い |
| content_gap | 完全一致キーワードではないが、テーマ単位で競合が扱い自社に無い(MVPでは完全一致ベースの判定が主体で、テーマクラスタリングは未実装) |

**データ不足の場合に推測でstrong判定はしない**(順位・表示回数データが無ければ`shared`寄りの
中立判定に倒す)。判定根拠(`reasons`)は`seo_keyword_candidates.score_breakdown.gap_reasons`に
保存される。

## 優先度スコア(0〜100点)

`config/juku.yaml`の`seo.competitor_analysis.priority_score_weights`で配点を調整できる
(既定: 地域関連性25/問い合わせ意図25/競合採用数15/競合順位10/検索需要10/自社順位改善余地10/季節性5)。
検索需要が0でも、地域関連性・問い合わせ意図が高ければ高得点になり得る(地域密着キーワードの
評価漏れを防ぐ設計)。内訳は候補詳細画面で確認できる。

## 候補ステータス

```
discovered → reviewing → approved → queued → article_created
                       ↘ rejected
                       ↘ monitoring
```

`queued`への遷移は`approved`からのみ許可される(二重登録防止、`scripts/lib/seo_db.js`の
`updateCandidateStatus`で強制)。操作履歴(日時・内容・理由・操作者)は
`seo_candidate_status_history`に保存される。

## 記事生成への連携

`use_for_topic_selection: true`の場合のみ、承認済み候補が智谷(planner-blog-btoc)の企画候補の
1つとして提示される(季節テーマの優先度は変えない)。競合ページの文章は一切コピーせず、
テーマ発見のためだけに使う。競合塾名を記事本文へ出さない・比較/批判記事にしない(既存の
「他塾への言及禁止」ルールと同じ扱い)。詳細は`.claude/agents/planner-blog-btoc.md`の
手順4b、`.claude/agents/writer-blog-btoc.md`の`seo_candidate_id`転記ルールを参照。

## データ保存方針

- DB(`posts.sqlite`に相乗り): URL・タイトル・見出し・抽出テーマ・スコア・ハッシュ・ステータス・根拠のみ
- `data/seo/pages/*.txt`: 競合ページの抽出後本文(gitignore対象。DBには入れずファイルで保持し、
  DB肥大化を避ける)
- 現時点でTTLベースの自動パージは未実装(既知の制限。`docs/seo_troubleshooting.md`参照)

## MVPの範囲外(将来対応)

- Google Ads APIへの切り替え(現状は`CsvKeywordMetricsProvider`のみ)
- 有料SERP APIへの接続(`SerpProvider`インターフェースのみ用意、実装は`CsvSerpProvider`/`ManualSerpProvider`)
- テーマ単位のクラスタリングによる`content_gap`の本格判定
- 推奨タイトル・構成のLLM生成(現状はダッシュボード上の候補情報のみ)
- 複数校舎対応・校舎別スコア
