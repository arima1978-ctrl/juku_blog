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
2. 智谷(planner-blog-btoc)     : 季節テーマ優先選定・採点(70点未満は原則やり直し)・
                                  CTA種別選定・出典記録 → data/plans/YYYY-MM-DD.json
  ↓
3. 檜山(writer-blog-btoc)      : 塾長本人として執筆(企画内容をfrontmatterへ転記)
                                  → data/drafts/YYYY-MM-DD-{slug}.md (status: written)
  ↓
4. 赤羽(editor-btoc)           : 校正・CTA整合性確認・メタ情報・アイキャッチメタデータ生成
                                  (同ファイル更新, status: edited)
  ↓
4.5 check_similarity.js / check_citations.js : 過去記事との類似度・出典IDの実在を
    決定的に検証しfrontmatterに記録(石橋が判定材料として使う)
  ↓
5. 石橋(verifier-local)        : 13項目のファクトチェック・コンプライアンス最終判定
    ├─ 軽微な問題は自ら直接修正 → status: verified
    ├─ 要修正 → status: revision_needed (檜山へ差し戻し。最大 generation.max_retry 回)
    └─ 上限超過 → status: escalated (人間判断が必要)
  ↓
sync_draft_to_db.js  : verified→review_pending / escalated→rejected として posts.sqlite に反映
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
| planner-blog-btoc(智谷) | `config/*.yaml`(`seasonal_topics.yaml`含む), `data/topics/`, `data/recent_titles.json`, `data/rejected_notes.json`, `data/episodes.md`, `data/parent_qa.md` | `data/plans/YYYY-MM-DD.json` |
| writer-blog-btoc(檜山) | `config/juku.yaml`, `data/plans/`, `data/episodes.md`, `data/parent_qa.md`, `docs/` | `data/drafts/YYYY-MM-DD-{slug}.md` |
| editor-btoc(赤羽) | 同上のdraft, `config/eyecatch_templates.yaml` | 同じdraftファイル(校正・CTA・メタ情報・アイキャッチメタデータ) |
| verifier-local(石橋) | `config/juku.yaml`, `data/topics/`, `data/plans/`, `data/episodes.md`, 対象draft(`similarity_check`/`citation_check`含む) | 同じdraftファイル(本文修正・fact_check_report・status・retry_count) |

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
| `docs/an-shingaku-jim.md` | 提供コース「アン進学ジム」の実データ |
| `.env`(gitignore対象) | `WP_URL`/`WP_USERNAME`/`WP_APP_PASSWORD`/`TELEGRAM_TOKEN`/`TELEGRAM_CHAT_ID`/`DASHBOARD_URL`/`PORT` |

## 文体・コンプライアンスの要点(詳細は各エージェント定義を参照)

- すべての記事は `author` に定義された**塾長本人が一人称で書いている体**で執筆する
- 実在の生徒エピソード・保護者Q&Aは `data/episodes.md`/`data/parent_qa.md` の**IDが付与された行**のみ使用可(`[EP-001]`/`[QA-001]`形式)。創作・架空IDの記載は禁止(`check_citations.js`が実在確認)
- 誇大表現・個人情報・他塾言及・根拠のない人気表現・発達心理医療の断定は禁止
- 実績数値を使う場合は年次を併記、学校名は`config/juku.yaml`の`area`に実在するもののみ
- 高校名は`area.target_high_schools`(偏差値55以上・minkou.jp基準)のみ使用可

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
