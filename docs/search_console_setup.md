# Google Search Console連携セットアップ

`features.competitor_keyword_analysis.search_console_enabled: true`の場合のみ使用する。
サービスアカウント方式を採用している(OAuthのトークンリフレッシュ管理を避け、`.env`に
静的な認証情報を保存する既存の運用方針(`WP_APP_PASSWORD`等)と一貫させるため)。

## 手順

1. [Google Cloud Console](https://console.cloud.google.com/)でプロジェクトを作成(または既存のものを使用)し、
   「Search Console API」を有効化する。
2. 「IAMと管理 > サービスアカウント」でサービスアカウントを新規作成し、JSON形式の鍵を発行する。
   ロールの付与は不要(Search Console側の権限で制御するため)。
3. 発行されたJSONの中の`client_email`をメモする。
4. [Search Console](https://search.google.com/search-console)の対象プロパティを開き、
   「設定 > ユーザーと権限 > ユーザーを追加」で、手順3の`client_email`を**閲覧者**権限で追加する。
5. プロジェクト直下の`.env`に以下を設定する(`.env.example`参照):

```
GSC_AUTH_MODE=service_account
GSC_PROPERTY_URL=https://an-english.com/
GSC_CLIENT_EMAIL=xxxxx@xxxxx.iam.gserviceaccount.com
GSC_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

`GSC_PRIVATE_KEY`はJSON鍵の`private_key`の値をそのまま(`\n`をエスケープしたまま)貼り付けてよい。
コード側(`scripts/lib/seo/search_console_provider.js`)で復元する。

`GSC_PROPERTY_URL`はSearch Console上でプロパティを登録した形式と一致させること
(ドメインプロパティなら`sc-domain:an-english.com`、URLプレフィックスプロパティなら
`https://an-english.com/`のようにスラッシュまで一致させる必要がある)。

## 動作確認

```bash
node scripts/seo_gsc_sync.js --dry-run
```

`--dry-run`はDBへ書き込まず取得行数のみ表示する。認証情報が正しければ直近数日分の
検索クエリ件数が表示される(0件でも正常。表示回数が少ない小規模サイトでは日によって
0件になることがある)。

## 注意事項

- 秘密鍵(`GSC_PRIVATE_KEY`)は`.env`以外に絶対にコミットしない(`.gitignore`で`.env`除外済み)。
- ログには秘密鍵を一切出力しない(`seo_gsc_sync.js`は`err.message`のみ記録する)。
- Search Consoleのデータには通常2〜3日程度の反映遅延がある。`seo_gsc_sync.js`は既定で
  直近3日分を取得することでこれを吸収する。
- API失敗時は`logs/errors.json`に記録されるだけで、記事生成・競合分析全体は止まらない。
- データ遅延・0件は正常な結果として扱われる(異常扱いにしない)。
