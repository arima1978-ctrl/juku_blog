-- posts テーブル: フェーズ2(WordPress REST API投稿)を見据えたスキーマ
CREATE TABLE IF NOT EXISTS posts (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at         TEXT NOT NULL,               -- 生成日時 (ISO8601)
  title              TEXT NOT NULL,                -- タイトル
  slug               TEXT NOT NULL UNIQUE,          -- URL用スラッグ(英数字)
  category           TEXT NOT NULL,                 -- 地域情報/勉強のコツ/入試情報/保護者コラム 等
  target_audience    TEXT,                          -- 想定読者(例: 中2保護者)
  keywords           TEXT,                          -- 想定検索キーワード(カンマ区切り)
  meta_description   TEXT,                          -- メタディスクリプション(120字以内)
  body_md            TEXT NOT NULL,                 -- 本文(Markdown)
  body_html          TEXT NOT NULL,                 -- 本文(HTML変換済み、WordPress投稿用)
  fact_check_report  TEXT,                          -- 石橋のチェック結果(JSON文字列)
  status             TEXT NOT NULL DEFAULT 'review_pending', -- review_pending/approved/rejected/scheduled/published
  reviewer_note      TEXT,                          -- 差し戻し時のメモ
  published_at       TEXT,                          -- 公開(予定)日時。scheduledの間は未来の予約日時、実際に公開されても値は更新しない
  wp_post_id         TEXT,                          -- WordPress投稿ID(フェーズ2用)
  wp_link            TEXT,                          -- WordPress投稿URL(予約中は?p=形式、公開後はパーマリンク)
  seasonal_topic_id  TEXT,                          -- config/seasonal_topics.yamlの採用テーマID(季節テーマ以外はNULL)
  publish_window_end TEXT,                          -- 採用テーマの公開可能期間の終了日(YYYY-MM-DD)。季節テーマ以外はNULL
  similarity_check   TEXT,                          -- 過去記事との類似度チェック結果(JSON文字列。scripts/check_similarity.js)
  plan_rationale     TEXT,                          -- 智谷の企画採用理由・採点結果(JSON文字列。.claude/agents/planner-blog-btoc.md)
  citations          TEXT                           -- 出典情報(episode_sources/parent_qa_sources/web_sources/citation_checkのJSON文字列)
);

CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);

-- エピソード素材(data/episodes.md が正だが、使用済みフラグの検索用に補助テーブルを用意)
CREATE TABLE IF NOT EXISTS episode_usage (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_key TEXT NOT NULL UNIQUE,   -- episodes.md内の行を特定するハッシュ/キー
  used_in_post_id INTEGER,
  used_at     TEXT,
  FOREIGN KEY (used_in_post_id) REFERENCES posts(id)
);
