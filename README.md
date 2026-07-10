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
│   ├── juku.yaml               ← 塾固有情報(塾ごとに差し替え。ハードコード禁止)
│   ├── calendar.yaml           ← 曜日別テーマ・季節文脈
│   ├── seasonal_topics.yaml    ← 日付範囲を持つ季節テーマ候補バンク
│   └── eyecatch_templates.yaml ← カテゴリー→アイキャッチテンプレートID
├── .claude/agents/
│   ├── researcher-local.md     ← 早瀬: 地域ネタ収集
│   ├── planner-blog-btoc.md    ← 智谷: 企画・採点・出典記録・CTA選定
│   ├── writer-blog-btoc.md     ← 檜山: 執筆(塾長本人として)
│   ├── editor-btoc.md          ← 赤羽: 校正・CTA・メタ情報・アイキャッチ
│   └── verifier-local.md       ← 石橋: ファクトチェック・コンプライアンス(13項目)
├── scripts/
│   ├── daily_blog.sh              ← 毎日実行するパイプライン本体(cron対象)
│   ├── init_db.js                 ← posts.sqlite 初期化
│   ├── sync_draft_to_db.js        ← 完成したdraftをposts.sqliteへ反映
│   ├── check_similarity.js        ← 過去記事との類似度チェック(石橋の前に実行)
│   ├── check_citations.js         ← 出典IDの実在検証(石橋の前に実行)
│   ├── sync_wordpress_status.js   ← WordPress公開状態をDBへ同期(daily_blog.shの冒頭)
│   ├── dry_run.js                 ← 投稿・DB登録せず診断表示
│   ├── refresh_indexes.js         ← 過去タイトル/差し戻し理由のインデックス再生成
│   ├── get_draft_status.js        ← 当日draftのstatus取得(daily_blog.shのループ制御用)
│   ├── log_error.js               ← logs/errors.json への記録
│   ├── api-server.js              ← ダッシュボード用Expressサーバー
│   └── lib/                       ← 共有ヘルパー(config/db/schedule/similarity/citations/
│                                      wordpress/wordpress_validation/wp_sync/telegram/season/
│                                      seasonal_topics/episodes/draft/json_field)
├── db/schema.sql               ← posts.sqlite のスキーマ(post_analyticsは将来のSearch Console連携用の設計のみ)
├── dashboard.html               ← ダッシュボードUI
├── test/                        ← node:testによる単体・結合テスト
└── data/
    ├── topics/YYYY-MM-DD.json   ← 早瀬の出力(gitignore対象)
    ├── plans/YYYY-MM-DD.json    ← 智谷の出力(gitignore対象)
    ├── drafts/YYYY-MM-DD-*.md   ← 檜山〜石橋が書き換えるdraft(gitignore対象)
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
