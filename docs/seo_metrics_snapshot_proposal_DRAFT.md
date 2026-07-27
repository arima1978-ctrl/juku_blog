# 小幡校 SEO効果測定: 週次スナップショット設計提案 — DRAFT・未承認

作成日: 2026-07-27。10/25プレゼン用エビデンス構築が目的。**この文書は提案段階。実装はユーザー承認後に着手する。**

## 前提として確定した実データ

- 小幡校(branch_id=1)の`seo_tasks`は現在69件(approved 58 / rejected 9 / reviewing 2)。
  `created_at`の最古行は`2026-07-13T12:43:10Z`、最新行は同日`14:51:41Z`
  → **コホート起点(Keyword Gap Lite運用開始日) = 2026-07-13** と特定できる(同日に69件が
  一括生成されており、それ以前の運用実績は無い)。
- 週次バッチ(`seo_weekly_analysis.sh`)は本番cronで**日曜01:00**に実行されている
  (ご提示の時刻と一致)。Gap判定(`seo_gap_calculate.js`)の後に本機能を追記する想定。
- GSC実績は`seo_gsc_queries`(日別・query別・page別)に蓄積されており、キーワード↔GSC実績の
  突合ロジックは`seo_gap_calculate.js`が`seoDbImpl`経由で既に実装済み(正規化キーワードでの
  マッチング)。新規に一致ロジックを作らず、この既存関数を再利用する。

## テーブル設計

グラフ化のしやすさ(10月頭に時系列グラフ出力スクリプトを作る前提)を優先し、EAV的な1テーブルに
まとめず、**校舎合計**と**キーワード別**を2テーブルに分離する(スコープごとにNULLが増える
ワイドテーブルを避け、`WHERE branch_id=? AND week_start BETWEEN ? AND ?`だけで素直にグラフ用
時系列が取れる形にする)。

```sql
-- 校舎単位の週次サマリー(1行 = 1校舎 × 1週)
CREATE TABLE IF NOT EXISTS seo_metrics_snapshots (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id                   INTEGER NOT NULL,
  week_start                  TEXT NOT NULL,   -- 月曜日(YYYY-MM-DD)。GSC実績の集計対象週
  week_end                    TEXT NOT NULL,   -- 日曜日(YYYY-MM-DD)
  impressions_total           INTEGER NOT NULL,
  clicks_total                INTEGER NOT NULL,
  impressions_school_page     INTEGER NOT NULL, -- config/school_pages.yaml登録ページ分
  clicks_school_page          INTEGER NOT NULL,
  impressions_blog            INTEGER NOT NULL, -- postsテーブル由来の記事ページ分
  clicks_blog                 INTEGER NOT NULL,
  gap_fulfilled_count         INTEGER NOT NULL, -- 実施済みタスク数(下記(c)参照)
  gap_total_count             INTEGER NOT NULL, -- 分母(approved かつ monitor/exclude除外)
  gap_fulfillment_rate        REAL NOT NULL,    -- gap_fulfilled_count / gap_total_count
  published_count_cumulative  INTEGER NOT NULL, -- posts.status='published'の累計(その週末時点)
  published_count_week        INTEGER NOT NULL, -- 当週分の新規published
  is_baseline                 INTEGER NOT NULL DEFAULT 0, -- 1=導入前バックフィルによる初回行
  computed_at                 TEXT NOT NULL,
  UNIQUE (branch_id, week_start)
);

-- キーワード単位の週次実績(1行 = 1校舎 × 1週 × 1キーワード候補)
CREATE TABLE IF NOT EXISTS seo_metrics_keyword_snapshots (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id         INTEGER NOT NULL,
  week_start        TEXT NOT NULL,
  week_end          TEXT NOT NULL,
  candidate_id      INTEGER,          -- seo_keyword_candidates.id(存在すれば)
  normalized_keyword TEXT NOT NULL,   -- 冗長保持(候補が将来アーカイブされても系列が切れないように)
  avg_position      REAL,             -- GSC平均掲載順位(実績なしの週はNULL)
  impressions       INTEGER NOT NULL DEFAULT 0,
  clicks            INTEGER NOT NULL DEFAULT 0,
  is_implemented_as_of_week INTEGER NOT NULL, -- そのキーワードに紐づくタスクが、その週末時点で実施済みだったか(0/1)
  is_baseline       INTEGER NOT NULL DEFAULT 0,
  computed_at       TEXT NOT NULL,
  FOREIGN KEY (candidate_id) REFERENCES seo_keyword_candidates(id),
  UNIQUE (branch_id, week_start, normalized_keyword)
);
CREATE INDEX IF NOT EXISTS idx_seo_metrics_keyword_snapshots_kw
  ON seo_metrics_keyword_snapshots(branch_id, normalized_keyword, week_start);
```

`is_implemented_as_of_week`をキーワード別スナップショット行に持たせることで、10/25プレゼンで
求められている「実施群だけが動いたことを示す」比較(実施済みキーワード群 vs 未実施キーワード群の
週次推移を並べたグラフ)が、実装日をまたいだ時系列でもそのまま集計できる
(実装前は0、実装後の週から1に切り替わる。将来タスクの実施が取り消された場合も再計算で追従)。

## (c) 69タスクの「実施済み/未実施」設計

`seo_tasks`に列を追加する:

```sql
ALTER TABLE seo_tasks ADD COLUMN implemented_at TEXT;      -- NULL=未実施。実施日時(ISO8601)
ALTER TABLE seo_tasks ADD COLUMN implementation_note TEXT; -- 任意メモ(例: 校舎ページ本文に追記済み)
```

判定方法(タスク種別ごとに自動判定できるものと、人が確定するものを分ける):

| task_type | 実施済みの判定方法 |
|---|---|
| `create_article` | `source_candidate_id`の`seo_keyword_candidates.status`が`article_created`になった時点で自動的に`implemented_at`をセット(既存の`sync_draft_to_db.js`の遷移に相乗り。またはtarget_post_idのposts.status='published'到達時点でも可) |
| `improve_school_page` / `add_internal_links` / `add_faq` / `improve_existing_article` | 自動検知不可(WordPress側のページ本文を人が手動編集するため)。ダッシュボード「Growth Director」タブに**「実施済みにする」ボタン**を追加し、押下時に`implemented_at`をセット(`POST /api/growth/tasks/:id/implement`を新設) |
| `monitor` / `exclude` | 実施対象外。`gap_total_count`(分母)から除外する(「未実施」として数えると分母が水増しされ充足率が不当に低く出るため) |

**ギャップ充足率の定義(確認したい点)**: `gap_total_count`の分母を
「`status='approved'` かつ `task_type NOT IN ('monitor','exclude')`」とする案で設計している
(=承認済みの実行可能タスクのうち、実際に手を付けた割合)。`rejected`(却下)を分母に含めない前提。
この定義でよいか承認時に確認したい。

## (a) ベースライン(導入前データ)の取得

```bash
node scripts/seo_gsc_sync.js --start=<16ヶ月前の月曜>--end=2026-07-12 --dry-run  # まず件数確認
node scripts/seo_gsc_sync.js --start=<16ヶ月前の月曜>--end=2026-07-12            # 本実行
```
既存の`seo_gsc_sync.js`は任意期間のbackfillに対応済み(コード変更不要)。取得後、新設スクリプト
`scripts/seo_metrics_snapshot_generate.js`(後述)を`--week=<2026-07-13を含む週より前の全週>
--baseline`で回し、`is_baseline=1`の初期スナップショット群として`seo_metrics_snapshots`/
`seo_metrics_keyword_snapshots`へ格納する。

## 週次バッチへの組み込み

`scripts/seo_weekly_analysis.sh`の末尾(Gap判定後)に1行追加する形を想定:
```bash
node scripts/seo_metrics_snapshot_generate.js --week=<当週の月曜> >> logs/seo_weekly.log 2>&1
```
新規スクリプト`scripts/seo_metrics_snapshot_generate.js`は、
`seo_gap_calculate.js`が既に持つGSC突合ロジックを再利用し、対象週の`seo_gsc_queries`と
`seo_keyword_candidates`/`seo_tasks`/`posts`を集計して2テーブルへUPSERTする(既定`--dry-run`、
`--save`明示時のみ保存。既存スクリプト群と同じ安全設計に揃える)。

## 10月の時系列グラフスクリプトへの見通し

`seo_metrics_snapshots`/`seo_metrics_keyword_snapshots`はどちらも`week_start`で素直にORDER BYでき、
`is_baseline`/`is_implemented_as_of_week`で系列を色分けできる設計にしてあるため、10月に作る
グラフ出力スクリプトは新規集計ロジックを持たず「このテーブルをSELECTしてChart化するだけ」で
済む想定。

## 未確定・確認したい点

1. ギャップ充足率の分母定義(上記)。
2. `implemented_at`を人が手動で確定するタスク種別について、ダッシュボードのボタン追加までを
   スコープに含めるか、まずはCLI(`node scripts/seo_task_mark_implemented.js <id>`)で十分か。
3. ベースライン取得の開始日(16ヶ月前ちょうどか、GSC側の実際の保持開始日をAPIから確認して合わせるか)。
