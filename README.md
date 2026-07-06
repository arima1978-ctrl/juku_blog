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

## フェーズ2(未実装・参考)

承認済み記事の自社HP(WordPress)への自動投稿。`posts.sqlite` の `status=approved` の記事を
WordPress REST API(`/wp-json/wp/v2/posts`)へ投稿し、`wp_post_id`・`published_at` を記録するだけで
接続できるようスキーマを設計済み。準備事項:

- WordPress管理画面でアプリケーションパスワードを発行(ユーザー → プロフィール → アプリケーションパスワード)
- 投稿専用ユーザーを「投稿者」権限で作成(管理者アカウントを自動化に使わない)
- `https://自社HPのURL/wp-json/wp/v2/posts` にアクセスしJSONが返ればREST API有効

フェーズ1では、承認済み記事は「本文コピー」ボタン(HTML形式/テキスト形式)で手動でWordPressに貼り付ける運用とする。
