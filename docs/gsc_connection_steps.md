# GSC接続手順(サービスアカウントのメールアドレス受領後にそのまま進める)

詳細セットアップは`docs/search_console_setup.md`参照。ここでは受領後の実行手順のみを番号付きでまとめる。

1. **`.env`設定**(本番サーバー): `GSC_CLIENT_EMAIL`(受領したサービスアカウントのメールアドレス)と
   `GSC_PRIVATE_KEY`(対応する秘密鍵。改行は`\n`のままでよい)を`/home/ubuntu/juku_blog/.env`に追記
2. **`search_console_enabled`を有効化**: `config/juku.yaml`の
   `features.competitor_keyword_analysis.search_console_enabled`を`true`に変更
   (CLAUDE.mdのルールにより、本番の設定ファイル変更は事前承認必須。このタイミングで確認する)
3. **バックフィルdry-run**: 件数・接続確認
   ```bash
   node scripts/seo_gsc_sync.js --start=<16ヶ月前の月曜> --end=2026-07-12 --dry-run
   ```
4. **本実行**: 問題なければ`--dry-run`を外して実行(DBバックアップ後)
   ```bash
   node scripts/seo_gsc_sync.js --start=<16ヶ月前の月曜> --end=2026-07-12
   ```
5. **キーワードスナップショットへの反映**: 次回の週次バッチ(日曜01:00)で自動的に
   `seo_metrics_snapshots`/`seo_metrics_keyword_snapshots`のGSC実績列(現在0埋めになっている
   `impressionsTotal`等)に反映される。急ぐ場合は手動実行も可能:
   ```bash
   node scripts/seo_metrics_snapshot_generate.js --week=<対象週の月曜> --baseline --save
   ```

## 判断材料

- GSC APIが実際に遡れる最古日は、3の`--dry-run`実行時のレスポンスで確認できる(サイトのSearch Console
  登録タイミングによっては16ヶ月に満たない場合がある)。取得できた最古日を正式なベースライン開始日とする
