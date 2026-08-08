# テスト分離監査(2026-08-08)

`config/juku.yaml`の`search_console_enabled`を`false→true`へ本番同期した際、
`test/seo_gsc_sync.test.js`の「featureが無効なら無処理で終了する」テストが、共有の
`config/juku.yaml`の実際の値に依存していたために**実際にGoogle Search Console APIへ
本物のネットワーク接続をしてしまった**(dry-runのためDB書き込みは無し)。この実インシデントを
きっかけに、テストの分離状況を`test/`配下全体で読み取り専用調査した記録。

対象コミット: `daily_blog_all.sh`の即時失敗通知強化(cccf643)〜config/juku.yaml同期(add5f29)。

## 改修の優先順位

1. **テスト実行時の外向き通信遮断ガード** — 個別テストの分離を1件ずつ直すより先に、
   `npm test`実行時にプロセス全体で外向きネットワークをデフォルト遮断する仕組み
   (例: `node --test`のセットアップフックで`https.request`/`fetch`をモックに差し替え、
   明示的に許可した接続<ローカルのfakeサーバー等>のみ通す)を入れるのが最優先。
   個別修正(2・3)より根本対策として効果が大きい。
2. **`test/seo_weekly_analysis.test.js`の実クロール有無の確認** — `JUKU_BLOG_CONFIG_PATH`の
   上書きなしで`scripts/seo_weekly_analysis.sh`を子プロセス起動しており、
   `config/seo_competitors.yaml`の`crawl_enabled: true`により競合サイトへ実クロールが
   走っている可能性がある(未実行のため未確認)。実際に走るか確認し、走るなら
   `crawl_enabled: false`の一時configへ差し替える。
3. **`test/seasonal_topics.test.js`の件数ピン留めを構造検証へ** — `topics.length === 62`/
   `windows.size === 12`という完全一致のハードコードを、季節テーマを追加するたびに
   手動更新している(52→57→59→62の変更履歴がコメントに残る)。件数の完全一致ではなく、
   「IDの重複が無い」「publish_windowが不正でない」等の構造検証へ寄せる。

## 0-1. 共有config/本番データを直接読んでいるテスト

`JUKU_BLOG_CONFIG_PATH`等の一時ファイル差し替えをせず、共有ファイルをそのまま読んでいる。

**`config/juku.yaml`を`loadJukuConfig()`で直接読む**
- `test/seo_config.test.js` — 2026-08-08修正済み(`search_console_enabled`の期待値を実態に合わせた)
- `test/branch_aware_config.test.js` — フォールバック機構の挙動テスト。値はピン留めしていない
- `test/seo_keyword_extractor.test.js`
- `test/seo_own_content_analyzer.test.js`
- `test/seo_opportunity_score.test.js`
- `test/seo_gsc_opportunity_pipeline.test.js`
- `test/seo_priority_scorer.test.js`

**`config/seo_competitors.yaml`を`loadSeoCompetitorsConfig()`で直接読む**
- `test/seo_brand_page_registry.test.js`
- `test/seo_school_page_registry.test.js`

**その他の共有configファイル**
- `test/exam_source_registry.test.js` — `config/aichi_exam_sources.yaml`
- `test/seasonal_topics.test.js` — `config/seasonal_topics.yaml`

**実スクリプトを子プロセス起動し、内部で共有configを読ませている**
- `test/seo_weekly_analysis.test.js` — `scripts/seo_weekly_analysis.sh`を`JUKU_BLOG_CONFIG_PATH`なしで起動

(`test/theme_calendar.test.js`は確認済みで、fakeデータを直接関数へ渡す設計のため対象外。)

## 0-2. 設定値次第で実際に外部ネットワークへ出うるもの

| テスト | 経路 | 現状 |
|---|---|---|
| `test/seo_gsc_sync.test.js` | GSC API | 2026-08-08に実際に発生。専用の一時config(`enabled: false`)へ分離済み |
| `test/seo_weekly_analysis.test.js` | 競合サイトへの実クロール + 内部で`seo_metrics_snapshot_generate.js`のTelegram通知経路も持つ | `JUKU_BLOG_CONFIG_PATH`の上書きなし。ローカル`.env`にTELEGRAM_TOKEN/WP系キーが無いためTelegram送信は現状失敗するが、競合サイトへの実クロール自体は`.env`に関係なく走る可能性(未確認、優先度2) |
| `test/sync_draft_to_db_draft_review.test.js` | WordPress下書き作成(`sync_mode: draft_review`) | テスト内コメントは「ローカルに.envが無いので必ず失敗する」という前提だが、実際にはこのリポジトリに`.env`は存在する(WP_URL等のキー自体が無いため現状は安全に失敗しているだけで、前提の記述が不正確) |
| `test/seo_metrics_digest.test.js` | Telegram(`sendTelegram`) | `env: process.env`をそのまま継承しているが、`--dry-run`がコード側で`sendTelegram()`呼び出し自体をスキップするため現状は安全 |

Anthropic API(`claude`実行)・Adobe Stock実APIを直接叩くテストは見つからなかった。

「たまたま`.env`に該当キーが無いから安全」な状態が複数あり、`.env`にWP/Telegramの認証情報を
追加した瞬間に、GSCで実際に起きたのと同じ事故が別の箇所でも起きる構造になっている
(優先順位1の外向き通信遮断ガードが根本対策)。

## 0-3. 本番設定の「値」自体をアサートしているテスト

| テスト | ピン留めしている値 | 深刻度 |
|---|---|---|
| `test/seasonal_topics.test.js` | `topics.length === 62`、`windows.size === 12` | 高(優先順位3)。季節テーマを1件足すたびに手動更新する運用になっている |
| `test/seo_priority_scorer.test.js` | `breakdown.area_relevance.points === 25`等(config側`priority_score_weights.area_relevance: 25`に暗黙依存) | 中 |
| `test/seo_school_page_registry.test.js` | `getSchoolPageById('obata').name === '小幡教室'`、URLの完全一致 | 中 |
| `test/seo_brand_page_registry.test.js` | `getBrandPageById('eikaiwa').wp_page_id === 546` | 中 |
| `test/seo_keyword_extractor.test.js` / `test/seo_own_content_analyzer.test.js` | 地域名「小幡」・学年「小1」等の存在(`.some()`) | 低〜中(既存項目の削除・改名でのみ壊れる) |
| `test/exam_source_registry.test.js` | `id === 'aichi_board_of_education' && tier === 1`の存在 | 低〜中 |

`test/seo_opportunity_score.test.js`/`test/seo_gsc_opportunity_pipeline.test.js`はconfigから
重みを読んではいるが、「全軸満点→100点」「全軸0→0点」という重み配分に依存しない不変条件のみを
検証しており、値のピン留めではない(問題なし)。
