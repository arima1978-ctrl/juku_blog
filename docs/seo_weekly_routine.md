# 週次SEOルーチン(10/25まで毎週)

毎週の作業を3ステップに固定する。合計目安10〜20分/週(承認件数による)。

## 1. ダッシュボードでタスク承認(5〜10分)

`http://<dashboard>/​` の「Growth Director」タブを開き、`proposed`のタスクを確認して承認/除外する。
両校舎(小幡・あま本部)を切り替えて確認すること。

## 2. 承認済みタスクの実施(記事化 or ページ改善)

- `create_article`系: 通常の記事生成パイプライン(日次自動生成)で自動的に手が動く。追加作業不要
- `improve_school_page`等: Page Plan/Page Draftの内容を確認し、WordPressの校舎ページへ手動で反映する
  (`docs/obata_page_draft_preview.md`のような形で都度確認)

## 3. 実施済みを確定(1〜2分)

反映が終わったタスクを実施済みとして記録する(自動検知できないため必須):

```bash
node scripts/seo_task_mark_implemented.js --task-id=<id> --note="校舎ページ本文に追記済み"
```

取り消したい場合は `--unset` を付ける。

## 補足

- 週次バッチ(日曜01:00)が自動でスナップショットを記録するため、上記3ステップ以外に手動でやることはない
- GSC接続後は、ベースライン・週次実績も同じスナップショットに自動で乗る(手順は`docs/gsc_connection_steps.md`参照)
- 進捗確認: `node -e "console.log(require('./scripts/lib/seo_db').listSeoMetricsSnapshots(<branch_id>))"` で蓄積状況を確認できる(10月のグラフ化スクリプトはここを参照する予定)
