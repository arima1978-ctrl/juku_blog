# あま本部校 セルフ運用移行(A案)提案 — DRAFT・未承認

作成日: 2026-07-27。**この文書は提案段階。実装はユーザー承認後に着手する。**
対象: あま本部校(branch_id=2想定, slug=ama-honbu)。小幡校は現行どおり「承認→WordPress予約投稿」を維持。

## 現状(調査結果)

- `wordpress.js`に`createDraftPost()`(status:'draft')が既に実装済み。ただし現状はGrowth Director
  のSEO Task単発Draft用(`seo_publisher.js`経由)にのみ使われており、日次ブログ承認フロー
  (`api-server.js`の`POST /api/posts/:id/approve`)には未接続。
- 承認フローは現状、校舎に関わらず`publishPost(post, { date: slot.wpDate })`を呼び、
  必ずstatus:'future'(予約投稿)になる。校舎別分岐は無い。
- `branches`テーブルに校舎別の同期モードを表す列は無い。
- `sync_wordpress_status.js`は「`scheduled`→`published`以外の遷移は`wp_sync_error`に記録するのみ
  (自動修復しない)」という設計。あま本部が`draft`運用になると、`draft`→`publish`(山口先生が手動公開)
  という**新しい正常遷移**が発生するため、このスクリプトの拡張が必須。

## (1) 校舎別 sync_mode 設計

### スキーマ変更(提案)
```sql
ALTER TABLE branches ADD COLUMN sync_mode TEXT NOT NULL DEFAULT 'scheduled';
-- 'scheduled' : 現行どおり。承認→publishPost(date指定)→WordPress予約投稿
-- 'draft_review' : 承認→createDraftPost()→WordPress下書き。人間(山口先生)がWP側で最終判断
```
- 小幡校は`sync_mode='scheduled'`のまま(既定値なので無変更で済む)。
- あま本部校のみ`sync_mode='draft_review'`に設定。
- `posts`テーブル側のstatusライフサイクルに`wp_draft_synced`を追加(`scheduled`と並ぶ扱い)。
  `approved` → (`sync_mode`で分岐) → `scheduled`(予約) or `wp_draft_synced`(WP下書き済み)
  → `published`(山口先生がWPで公開したことを検知して自動遷移)。

### ダッシュボード承認ゲートとの関係(二重ゲート問題への提案)

ご指摘のとおり、あま本部を「ダッシュボード承認 → さらにWP下書きレビュー」のままにすると、
山口先生からは「二重チェック」に見えて形骸化しやすい構造です。以下の対応を提案します。

**提案: ダッシュボード側の承認を「自動承認」にし、レビューの実質はWP下書きに一本化する**

- `sync_draft_to_db.js`が石橋(verifier-local)からverified判定を受け取った際、
  `sync_mode='draft_review'`の校舎に限り、`review_pending`ではなく即座に`approved`相当の
  処理(＝`POST /api/posts/:id/approve`と同じロジック)を自動実行する
  (公開期限チェック・連続投稿警告など既存の安全チェックはそのまま活かす)。
- これにより人間のクリックによる承認ステップは無くなるが、DB上の承認記録・タイムスタンプは残り、
  監査性は失われない。実質的なレビューは「WP下書きを見て公開/編集/ゴミ箱」の1箇所に統一される。
- ダッシュボードの記事一覧では、あま本部の記事は「WP下書き同期済み(要WPで確認)」という表示にし、
  承認ボタン自体を非表示にする(押しても意味が無いボタンを残さない = 形骸化を避ける)。
- 石橋の差し戻し(`revision_needed`/`escalated`)は従来どおりダッシュボードに残す
  (ここは山口先生ではなく運営側が見る品質ゲートなので、あま本部でも維持)。

**代替案(不採用理由つきで記録)**: ダッシュボード承認を完全に残し、WP下書きは「保険」として使う
二重運用も検討したが、「押すだけの承認ボタン」が実質不要になり、いずれ誰も見なくなるリスクが
高いため非推奨。

### `sync_wordpress_status.js` の拡張(必須)

- `wp_draft_synced`の記事について、WP側status確認結果に応じて:
  - `draft`のまま → 変更なし(まだ山口先生が見ていない)
  - `publish` / `future` → ローカルを`published`(または`scheduled`)へ自動遷移
  - `trash` → ローカルを`rejected`相当へ遷移し、`reviewer_note`に
    「あま本部WP下書きでゴミ箱へ移動」を記録。将来的には`rejected_notes.json`への反映も検討
    (智谷の翌日企画に活かせるが、今回のA案スコープ外・フェーズ2候補として記録のみ)。
  - それ以外の想定外status → 従来どおり`wp_sync_error`記録のみ(自動修復しない)。

## (2) 通知方式

毎朝05:00の定時生成である前提を踏まえ、3案を判断材料つきで提示します。

| 案 | 実装 | 長所 | 短所・リスク |
|---|---|---|---|
| A. WP側フック + `wp_mail()` | `an-english.com`の管理画面からfunctions.php(またはmu-plugin)に`transition_post_status`フックを1つ追加。新規依存なし | 本リポジトリのコード変更ゼロ。WP管理者(既存アカウント)だけで完結 | WPのメール送信(既定PHP mail())が不安定なホストがある。他のWP通知メール(コメント通知等)が正常に届いているか要確認 |
| B. パイプライン側送信 | `createDraftPost()`成功時にnodemailer等を新規導入しSMTP経由で送信 | WPの状態に依存しない、確実性が上げやすい | 新規依存追加・SMTP認証情報の管理(.env)が必要。本リポジトリの変更範囲が増える |
| C. 通知なし(毎朝チェック運用) | 実装不要 | 最も単純。壊れる通知インフラが無い | 山口先生が失念すると下書きが放置される |

**推奨: まずC(通知なし)で開始し、既存の期限超過警告の仕組みを流用して安全網を張る。**
理由: `api-server.js`には既に「公開期限(`publish_window_end`)超過時にTelegram通知」の仕組みがある
(季節テーマの記事が期限内に公開されないと運営側Telegramに警告が飛ぶ)。これは`sync_mode`に関わらず
機能するため、山口先生への直接通知が無くても「季節ネタが埋もれて公開し損ねる」という最悪ケースは
既存の仕組みで運営側が気づける。まずは通知なしで運用し、実際に失念が発生するようなら案A(WP側フック)
を追加する、という段階導入を提案する。

C運用時の判断材料:
- 生成は1日1本・時刻固定(05:00以降であれば確実に存在)なので、「毎朝の決まった時間に開く」習慣化が
  比較的容易(不定期到着のメールより忘れにくい可能性もある)。
- 一方、体調不良・出張等で数日空くと下書きが複数溜まる。溜まった下書き一覧の見やすさは
  WP標準の下書き一覧(投稿者フィルタ)で十分実用的。

## (3) 1枚手順書

別ファイル`docs/ama_honbu_yamaguchi_manual_DRAFT.md`にドラフトを作成した。内容は本提案の承認後、
実装内容(通知有無・下書きURL等)に合わせて最終化する。

## (4) 切替当日の検証手順(提案)

1. 実装(sync_mode列追加・approve分岐・sync_wordpress_status.js拡張)をあま本部以外に影響が
   無い状態でデプロイ(小幡校は`sync_mode='scheduled'`のまま=無変更のはずなので、
   小幡校の翌朝生成が従来どおり予約投稿になることも合わせて確認する)。
2. あま本部の`sync_mode`を`draft_review`に切り替え。
3. 翌朝05:00の生成を待つ(または`node scripts/dry_run.js`で事前に流れを確認)。
4. 生成された1本について:
   - ダッシュボードのpostsで`wp_draft_synced`になっていること(`scheduled`になっていないこと)
   - WordPress管理画面で該当記事が実際に「下書き」ステータスであること(「予約済み」表示でないこと)
   - あま本部のwordpress_author_id/category_idが正しく設定されていること
   を確認する。
5. 問題なければ手順書(最終版)を山口先生に渡す。問題があれば`sync_mode`を`scheduled`に戻せば
   即座に旧運用へフォールバックできる(切り戻しが1列の値変更で済む設計にしている)。
