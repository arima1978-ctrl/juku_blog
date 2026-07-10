# juku_blog

学習塾向け 地域密着ブログ自動生成システム(フェーズ1: 生成〜ダッシュボード確認・承認)。

パイプラインの全体設計・各エージェントの役割は [`CLAUDE.md`](./CLAUDE.md) を参照。

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
│   └── calendar.yaml           ← 曜日別テーマ・季節文脈
├── .claude/agents/
│   ├── researcher-local.md     ← 早瀬: 地域ネタ収集
│   ├── planner-blog-btoc.md    ← 智谷: 企画
│   ├── writer-blog-btoc.md     ← 檜山: 執筆(塾長本人として)
│   ├── editor-btoc.md          ← 赤羽: 校正・CTA・メタ情報
│   └── verifier-local.md       ← 石橋: ファクトチェック・コンプライアンス
├── scripts/
│   ├── daily_blog.sh            ← 毎日実行するパイプライン本体(cron対象)
│   ├── init_db.js               ← posts.sqlite 初期化
│   ├── sync_draft_to_db.js      ← 完成したdraftをposts.sqliteへ反映
│   ├── refresh_indexes.js       ← 過去タイトル/差し戻し理由のインデックス再生成
│   ├── get_draft_status.js      ← 当日draftのstatus取得(daily_blog.shのループ制御用)
│   ├── log_error.js             ← logs/errors.json への記録
│   ├── api-server.js            ← ダッシュボード用Expressサーバー
│   └── lib/                     ← 共有ヘルパー(config/db/season/episodes/draft)
├── db/schema.sql               ← posts.sqlite のスキーマ
├── dashboard.html               ← ダッシュボードUI
└── data/
    ├── topics/YYYY-MM-DD.json   ← 早瀬の出力(gitignore対象)
    ├── plans/YYYY-MM-DD.json    ← 智谷の出力(gitignore対象)
    ├── drafts/YYYY-MM-DD-*.md   ← 檜山〜石橋が書き換えるdraft(gitignore対象)
    ├── episodes.md              ← 塾長の実体験ストック(コミット対象)
    ├── recent_titles.json       ← 過去90日タイトル(自動生成、gitignore対象)
    ├── rejected_notes.json      ← 差し戻し理由(自動生成、gitignore対象)
    └── posts.sqlite             ← 記事DB(gitignore対象。init-dbで生成)
```

## フェーズ2(実装済み・認証情報投入待ち)

ダッシュボードで「承認」を押すと、`scripts/lib/wordpress.js` が即座にWordPress REST API
(`/wp-json/wp/v2/posts`)へ記事を投稿(公開)し、`wp_post_id`・`wp_link`・`published_at` を記録する。
結果は`scripts/lib/telegram.js`経由でTelegramにも通知される(`.env`未設定ならスキップ)。

セットアップ手順(`.env.example` も参照):

1. WordPress管理画面(`https://an-english.com/wp/wp-admin`)で自動投稿専用ユーザーを
   「投稿者」権限で作成する(管理者アカウントを自動化に使わない)
2. そのユーザーのプロフィール画面 → アプリケーションパスワード で新規発行する
3. プロジェクト直下に `.env` を作成し、`WP_URL` / `WP_USERNAME` / `WP_APP_PASSWORD` を設定する
   (Telegram通知も使う場合は `TELEGRAM_TOKEN` / `TELEGRAM_CHAT_ID` も設定)
4. 投稿先カテゴリーは `config/juku.yaml` の `wordpress.category_id` で固定IDを指定する。
   an-english.comは教室ごとに同名の子カテゴリー(コラム/学校情報/教室の様子等)が並ぶ構造のため、
   名前検索ではなくID指定にしている(投稿者権限には新規カテゴリー・タグ作成権限がないため、
   指定IDが誤っていると付与されずスキップされる。タグはキーワードから名前検索で付与される)

`.env` が未設定の間は投稿がエラーになり `logs/errors.json` に記録されるが、承認自体は成立する
(ステータスは `approved` のまま残り、ダッシュボードで再度「承認」を押すと投稿をリトライできる)。
承認済み記事は引き続き「本文コピー」ボタン(HTML形式/テキスト形式)でも取得できるので、
自動投稿が失敗した場合の手動フォールバックとして使える。
