# juku_blog システム仕様書(2026-07-10時点)

## 概要

学習塾(アンイングリッシュグループ 小幡校)の生徒募集(体験授業・問い合わせ獲得)を目的とした、**BtoC・地域密着型ブログ記事の自動生成〜承認〜WordPress公開システム**。

- 読者: 小学生・中学生の保護者(主)、生徒本人(従)
- 狙い: 地域名+「塾」等の検索流入獲得
- 公開先: `https://an-english.com`(WordPress)

## 全体フロー

```
[毎朝05:00 cron]
  ↓
5エージェントパイプライン(記事生成)
  ↓
posts.sqlite に review_pending として登録
  ↓
人間がダッシュボードで確認・承認/差し戻し
  ↓
承認 → WordPressへ自動で「予約投稿」(1日1本ペースを維持)
  ↓
Telegramに承認・投稿結果を通知
```

## 1. 記事生成パイプライン

5体のエージェントが順に処理する(各エージェントは `claude -p --agent <name>` で個別呼び出し)。

| 順 | エージェント | 役割 | 入力 | 出力 |
|---|---|---|---|---|
| 1 | 早瀬(researcher-local) | 地域ネタ収集(WebSearch) | `config/juku.yaml` | `data/topics/YYYY-MM-DD.json` |
| 2 | 智谷(planner-blog-btoc) | 曜日/季節+ネタ+過去記事から企画決定 | topics, 過去タイトル, 差し戻し履歴, エピソード素材 | `data/plans/YYYY-MM-DD.json` |
| 3 | 檜山(writer-blog-btoc) | 塾長本人の一人称で執筆 | plan, エピソード素材 | `data/drafts/YYYY-MM-DD-{slug}.md`(status: written) |
| 4 | 赤羽(editor-btoc) | 校正・CTA・メタディスクリプション付与 | 同draft | 同draft更新(status: edited) |
| 5 | 石橋(verifier-local) | ファクトチェック・コンプライアンス最終判定 | 同draft | 軽微修正は自ら直す→verified / 要修正→revision_needed(檜山へ差し戻し、上限は`generation.max_retry`) / 上限超過→escalated |

最後に `scripts/sync_draft_to_db.js` が `verified→review_pending`、`escalated→rejected` として `posts.sqlite` に反映する。

`scripts/daily_blog.sh` がこの一連をcronで実行し、失敗時は `scripts/log_error.js` でエラーを記録する。

## 2. コンプライアンス・文体ルール

- 全記事は塾長本人(米澤由里子)が一人称で書いている体裁
- 実在の生徒エピソードは `data/episodes.md`、保護者との実際のLINEやり取りは `data/parent_qa.md` にある素材のみ使用可。創作は禁止
- 誇大表現(景品表示法)・個人情報・他塾言及は禁止。実績数値には年次を併記
- 高校名は `config/juku.yaml` の `area.target_high_schools`(偏差値55以上、minkou.jp基準)にある学校のみ使用可

## 3. データベース(`data/posts.sqlite`)

Node.js組み込みの `node:sqlite`(Node 22.5+必須。better-sqlite3等ネイティブビルド必須パッケージは不使用)。

**status ライフサイクル:**

```
review_pending(確認待ち)
  → approved(承認。この直後に自動でWordPress予約投稿処理が走る)
  → scheduled(WordPress側でstatus:futureとして予約済み。wp_post_id/wp_link/公開予定日時を記録)
  → rejected(差し戻し。理由は data/rejected_notes.json に反映され、翌日の智谷が参照)
```

`published` ステータス値も定義上残っているが、現行の運用ではWordPress側のwp-cronが予約時刻に自動で公開するため、ローカルDB側は`scheduled`のまま更新しない(WordPress側が実体の正)。

## 4. ダッシュボード

- `dashboard.html` + `scripts/api-server.js`(Express、既定ポート3013)
- 機能: 記事一覧・詳細プレビュー・承認/差し戻し・エピソード素材追加・月次サマリー表示
- 記事一覧はステータス/カテゴリでフィルタ可能
- 承認済み記事は「本文コピー」ボタン(HTML/テキスト)でも取得可能(自動投稿失敗時の手動フォールバック用)

## 5. WordPress自動投稿(フェーズ2)

`scripts/lib/wordpress.js` がWordPress REST API(`/wp-json/wp/v2/posts`)へBasic認証(アプリケーションパスワード)で投稿する。

**認証アカウントについて:** このWordPressサイトの学校ページ(`/school/obata/`)には「教室からのBLOG」という一覧ウィジェットがあり、これは**投稿者ID(著者)で絞り込まれている**(カテゴリーではない)。そのため、投稿は塾長の実アカウント(投稿者権限、表示名「米澤由里子」)で行う必要がある。専用botアカウントを別途作ると、記事は公開されても学校ページの一覧には反映されない。

**カテゴリーについて:** このサイトは教室ごとに同名の子カテゴリー(「コラム」「学校情報」「教室の様子」等)が並ぶ構造になっており、名前で検索すると他教室の同名カテゴリーに誤爆する。そのため名前検索はせず、`config/juku.yaml` の `wordpress.category_id` に固定IDを設定して使う(小幡教室 > コラム = ID 263)。

**タグについて:** タグは教室横断で共有される想定のため、記事のキーワードから名前で検索し、見つかったものだけを付与する(投稿者権限には新規タグ作成権限がないため、見つからないタグは付けずに投稿する)。

## 6. 予約投稿ロジック(まとめ承認時の同日集中を防止)

ダッシュボードの確認が不定期になる可能性があるため、複数記事をまとめて承認しても同日に一気に公開されないよう、**承認のたびに次の公開枠(前回の予約済み/公開済み日の翌日)を自動計算して予約投稿(WordPress `status: future`)する。**

- 対象サイトのタイムゾーンはJST(確認済み)。`config/juku.yaml` の `generation.run_time`(既定05:00)を予約時刻として使う
- アルゴリズム: `posts.sqlite` 内の `scheduled`/`published` レコードのうち最新の予約(公開予定)日を取得し、その翌日を次の予約日とする。まとめて3件承認すれば、翌日・翌々日・翌々々日…と1日1本ペースで自動的に割り振られる
- 初回(過去の予約実績がない場合)は「明日」から開始する(当日には公開しない)

## 7. Telegram通知

承認ボタンを押した**直後、WordPress投稿処理を始める前**に、ダッシュボードへのリンク付きで通知する(投稿完了後の事後通知ではなく事前通知)。WordPress投稿に失敗した場合のみ、追加でエラー通知を送る。

- 通知先: 専用グループ(botを招待する形式)
- 未設定(`TELEGRAM_TOKEN`/`TELEGRAM_CHAT_ID`)の場合は通知をスキップするだけで、承認・投稿フロー自体は止まらない

## 8. 設定ファイル

| ファイル | 内容 |
|---|---|
| `config/juku.yaml` | 塾名・地域・対象学年・塾長ペルソナ・生成パラメータ・WordPressカテゴリーID。**塾ごとにこのファイルだけ差し替えれば他塾展開できる設計**(ハードコード禁止) |
| `config/calendar.yaml` | 曜日別テーマ・季節文脈(定期テスト前/夏休み前/入試直前/新学年準備) |
| `docs/an-shingaku-jim.md` | 提供コース「アン進学ジム」の実データ(指導方針・料金・成果例等) |
| `.env`(gitignore対象) | `WP_URL`/`WP_USERNAME`/`WP_APP_PASSWORD`/`TELEGRAM_TOKEN`/`TELEGRAM_CHAT_ID`/`DASHBOARD_URL`/`PORT` |

## 9. デプロイ構成

- **本番環境**: さくらVPS(Ubuntu、PM2でプロセス管理)
- ダッシュボード: PM2プロセス `juku-blog-dashboard`、ポート3013(localhost限定バインド)
- 外部アクセス: `https://jukublog.duckdns.org` 経由(DuckDNS + nginxリバースプロキシ + Let's Encrypt HTTPS + Basic認証)。サーバーのパケットフィルタでは3013番ポート自体は非開放(nginxの80/443のみ外部到達可能)
- 自動生成cron: 毎朝05:00(JST)に `daily_blog.sh` を実行
- `claude` CLIの認証はOAuthトークンベース。有効期限が切れることがあるため、cronが失敗し始めたら対話的に `claude` を起動して再ログインが必要になる場合がある

## 10. 未実装・今後の課題

- ローカルDBの `scheduled` ステータスは、実際にWordPress側で公開時刻を迎えても自動では `published` に遷移しない(WordPress側が実体の正という前提。厳密な状態同期は未実装)
- 差し戻し(`rejected`)理由の分析・改善提案の自動化は未着手
- 記事へのアイキャッチ画像の自動設定は未実装
