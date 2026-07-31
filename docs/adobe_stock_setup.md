# Adobe Stock API 初回セットアップ手順(アイキャッチ写真自動挿入機能)

対象: 個人プランのAdobe Stockアカウントをお持ちの方。この手順は**最初に1回だけ**、ご自身のPC(ブラウザが使える環境)で行います。以降は本番サーバーが無人で動きます。

## 手順1: Adobe Developer Consoleで認証情報を発行する

1. ブラウザで https://developer.adobe.com/console を開き、ご自身のAdobeアカウントでログインする
2. 「Create new project」(新規プロジェクト作成)を選ぶ
3. プロジェクト内で「Add API」(APIを追加)を選び、一覧から **Adobe Stock** を選択して次へ進む
4. 認証方式(Credential)を選ぶ画面が出たら、**OAuth Web App**(「OAuth Server-to-Server」ではない方)を選ぶ
   - Server-to-Serverは個人プランでは使えない(Enterprise専用)ため、必ずWeb Appを選ぶこと
5. **Redirect URI**(リダイレクトURI)の入力欄に、以下をそのまま入力する:
   ```
   http://localhost:8734/callback
   ```
6. 保存すると、プロジェクトのダッシュボードに以下の3点が表示される:
   - **Client ID**
   - **Client Secret**(「Retrieve client secret」等のボタンで表示させる必要がある場合あり)
   - **Scopes**(このAPIに紐づく権限の一覧。通常`openid,AdobeID,additional_info.stock`のような形式で表示される)

## 手順2: 認証情報を`.env`に設定する

`.env`ファイル(プロジェクトルート)に以下の3行を追加し、手順1で確認した値を貼り付ける:

```
ADOBE_STOCK_CLIENT_ID=(Client IDを貼り付け)
ADOBE_STOCK_CLIENT_SECRET=(Client Secretを貼り付け)
ADOBE_STOCK_SCOPE=(表示されたScopesをそのまま貼り付け)
```

**表示されたScopesの値が分からない・想定と違う形式の場合は、画面のスクリーンショットまたはテキストをそのまま共有してください。こちらで正しい設定に調整します。**

## 手順3: 認証スクリプトを実行する

ターミナルで以下を実行する:

```bash
node scripts/adobe_stock_oauth_setup.js
```

- コンソールに認可用のURLが表示されるので、それをブラウザで開く
- Adobeのログイン画面が出るので、ログイン・アクセス許可(Allow)する
- 許可すると自動的に`http://localhost:8734/callback`へリダイレクトされ、ブラウザに「認証を受け付けました」という短いメッセージが表示される(そのタブは閉じてよい)
- ターミナル側で自動的にトークン交換 → `.env`への保存 → 動作確認(プラン枠の取得)まで進む
- 最後に表示される「プラン枠の情報」(JSON)をそのまま共有してください。実際の月間枠数を確認してPhase 2の運用方針を決めます

## うまくいかない場合

- 「codeパラメータがありません」等が出た場合: Redirect URIがDeveloper Console側の設定(手順1-5)と完全に一致しているか確認してください(`http://localhost:8734/callback`、末尾のスラッシュ等も含め完全一致が必要)
- トークン交換でエラーが出た場合: エラーメッセージ全文を共有してください。Client Secretの貼り付けミス、または地域によって認証サーバーのドメイン(`ims-na1.adobelogin.com`)が異なる場合があるため、その場合はこちらで調整します
