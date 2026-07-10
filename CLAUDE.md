# juku_blog プロジェクト

学習塾の生徒募集(体験授業・問い合わせの獲得)を目的とした、**BtoC・地域密着型ブログ記事の自動生成システム**。
読者は「小学生・中学生の保護者」が主、「生徒本人」が従。地域の検索流入(例:「◯◯市 塾」)を獲得する。

## フェーズ

- **フェーズ1(実装済み)**: 記事の自動生成 → ローカル保存(`data/posts.sqlite`) → `dashboard.html` でのプレビュー・承認/差し戻し管理
- **フェーズ2(未実装)**: 承認済み記事のWordPress自動投稿。`posts.sqlite` の `wp_post_id` / `published_at` はこのために予約済み

## パイプライン全体像

```
早瀬(researcher-local)      : 地域ネタ収集 → data/topics/YYYY-MM-DD.json
    ↓
智谷(planner-blog-btoc)     : 曜日/季節+ネタ+過去記事から企画決定 → data/plans/YYYY-MM-DD.json
    ↓
檜山(writer-blog-btoc)      : 塾長本人として執筆 → data/drafts/YYYY-MM-DD-{slug}.md (status: written)
    ↓
赤羽(editor-btoc)           : 校正・CTA・メタ情報付与(同ファイル更新, status: edited)
    ↓
石橋(verifier-local)        : ファクトチェック・コンプライアンス最終判定
    ├─ 軽微な問題は自ら直接修正 → status: verified
    ├─ 要修正 → status: revision_needed (檜山へ差し戻し。最大 config/juku.yaml の generation.max_retry 回)
    └─ 上限超過 → status: escalated (人間判断が必要。エラーとしても記録)
    ↓
scripts/sync_draft_to_db.js  : verified→review_pending / escalated→rejected として posts.sqlite に反映
```

`scripts/daily_blog.sh` がこの一連の流れをcronで毎朝実行する(各エージェントは `claude -p --agent <name>` で個別に呼び出す)。

## 各エージェントの担当ファイル(厳守)

| エージェント | 読む | 書く |
|---|---|---|
| researcher-local(早瀬) | `config/juku.yaml` | `data/topics/YYYY-MM-DD.json` |
| planner-blog-btoc(智谷) | `config/*.yaml`, `data/topics/`, `data/recent_titles.json`, `data/rejected_notes.json`, `data/episodes.md`, `data/parent_qa.md` | `data/plans/YYYY-MM-DD.json` |
| writer-blog-btoc(檜山) | `config/juku.yaml`, `data/plans/`, `data/episodes.md`, `data/parent_qa.md` | `data/drafts/YYYY-MM-DD-{slug}.md` |
| editor-btoc(赤羽) | 同上のdraft | 同じdraftファイル(校正・meta_description・status更新のみ) |
| verifier-local(石橋) | `config/juku.yaml`, `data/topics/`, `data/plans/`, `data/episodes.md`, 対象draft | 同じdraftファイル(本文修正・fact_check_report・status・retry_count) |

他エージェントの担当ファイルを勝手に書き換えないこと。`data/posts.sqlite` への書き込みはどのエージェントも行わない(`scripts/sync_draft_to_db.js` と `scripts/api-server.js` のみが書き込む)。

## status ライフサイクル

**draft frontmatter(パイプライン内部)**: `written` → `edited` → `verified` / `revision_needed` / `escalated`

**posts.sqlite(人間向け)**: `review_pending`(確認待ち) → `approved`(承認) or `rejected`(差し戻し) → `published`(フェーズ2で自動化予定、現状は手動更新)

## 設定ファイル

- `config/juku.yaml`: 塾名・地域・対象学年・塾長ペルソナ(`author`)・生成パラメータ。**塾ごとにこのファイルだけ差し替えれば他塾にも展開できる設計**(ハードコード禁止)
- `config/calendar.yaml`: 曜日別テーマ・季節文脈(定期テスト前/夏休み前/入試直前/新学年準備)
- `docs/an-shingaku-jim.md`: 提供コース「アン進学ジム」(個別指導)の実データ(指導方針・授業形式・料金体系・成果例等)。檜山がコース内容に具体的に触れる記事を書く際に参照する

## 文体・コンプライアンスの要点(詳細は各エージェント定義を参照)

- すべての記事は `author` に定義された**塾長本人が一人称で書いている体**で執筆する
- 実在の生徒エピソードは `data/episodes.md` にある素材のみ使用可。創作は禁止(石橋が検出)
- 誇大表現(景品表示法)・個人情報・他塾への言及は禁止
- 実績数値を使う場合は年次を併記する
- **高校名は `config/juku.yaml` の `area.target_high_schools` にある学校のみ使用する**(偏差値55以上・minkou.jp基準で厳選済み)。偏差値の低い高校名を出さないこと(2026-07-06 ユーザー指示: 「この塾は馬鹿が行く塾」という印象を保護者に持たれるため)

## ダッシュボード

- `dashboard.html` + `scripts/api-server.js`(Express, 既定ポート3013)
- 記事一覧・詳細プレビュー・承認/差し戻し・エピソード素材入力ができる
- 差し戻し時のメモは `data/rejected_notes.json` に反映され、翌日の智谷が同じ失敗を繰り返さないよう参照する

## 運用パラメータ

- 差し戻し上限: `config/juku.yaml` の `generation.max_retry`(既定2)
- 1日の生成本数: `config/juku.yaml` の `generation.daily_count`(既定1)
- 生成バッチ起動時刻: `config/juku.yaml` の `generation.run_time`(既定05:00)
