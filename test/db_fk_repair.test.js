'use strict';

// 2026-07-17判明: 一部の既存DB(本番含む)で、seo_competitor_pages等のFOREIGN KEY定義が
// 実在しない一時テーブル名(<table>_pre_branch_id)を指したまま固定されてしまっていた
// (branch_id移行がensureBranchIdRebuild()の現行の安全な形になる前の、いずれかの過去の
// タイミングで発生したと推測される)。schema.sqlのCREATE TABLE IF NOT EXISTSは既存テーブルの
// 定義を書き換えないため、このバグを抱えたまま作成された既存DBファイルは、そのINSERT時に
// 初めて「no such table: main.<table>_pre_branch_id」として表面化する。
// scripts/lib/db.jsのensureNoStaleForeignKeyReferences()がgetDb()内で自動的にこれを
// 検知・修復することを検証する。

const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_db_fk_repair_test_${process.pid}.sqlite`);

after(() => {
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    // 既に無ければ無視
  }
});

// 本番で実際に発生していたのと同じ壊れ方(FOREIGN KEYが実在しない一時テーブル名を指す)を
// 直接再現する。これはensureBranchIdRebuild()自体のバグではなく、その安全な現行実装が
// できる前の過去のいずれかの移行タイミングで発生したと推測される既存DBの状態を模している。
function seedCorruptedDb(filePath) {
  const conn = new DatabaseSync(filePath);
  conn.exec(`
    CREATE TABLE seo_competitors (
      id TEXT PRIMARY KEY,
      branch_id INTEGER,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      crawl_enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  conn
    .prepare(
      'INSERT INTO seo_competitors (id, branch_id, name, domain, crawl_enabled, created_at, updated_at) VALUES (:id, :branch_id, :name, :domain, 1, :now, :now)'
    )
    .run({ id: 'itto.jp', branch_id: 2, name: 'ITTO個別指導学院 あま美和校', domain: 'www.itto.jp', now: '2026-07-16T00:00:00.000Z' });

  // seo_competitor_pagesのFOREIGN KEYを、実在しない"_pre_branch_id"付きテーブル名で
  // 意図的に壊した状態で作成する(本番で実際に見つかった状態そのもの)。
  conn.exec(`
    CREATE TABLE seo_competitor_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      competitor_id TEXT NOT NULL,
      url TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      content_hash TEXT,
      last_analyzed_at TEXT,
      fetched_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (competitor_id) REFERENCES "seo_competitors_pre_branch_id"(id),
      UNIQUE (competitor_id, canonical_url)
    );
  `);
  // 修復前から既に存在していた実データ(壊れる前のクロール結果)を1件入れておく。
  // 修復後もこの行が消えずに残ることを確認する。
  // (この行自体は本来FKが壊れる前に挿入されていたはずのデータを模しているため、
  // フィクスチャ構築時のみforeign_keysをOFFにして矛盾なく挿入する)
  conn.exec('PRAGMA foreign_keys = OFF');
  conn
    .prepare(
      `INSERT INTO seo_competitor_pages (competitor_id, url, canonical_url, content_hash, fetched_at, created_at, updated_at)
       VALUES (:cid, :url, :url, 'hash1', :now, :now, :now)`
    )
    .run({ cid: 'itto.jp', url: 'https://www.itto.jp/school/amamiwa/', now: '2026-07-16T00:00:00.000Z' });
  conn.exec('PRAGMA foreign_keys = ON');

  conn.close();
}

test('getDb(): 既存テーブルのFOREIGN KEYが実在しない_pre_branch_id名を指している場合、自動的に正しい参照へ修復する', () => {
  seedCorruptedDb(TMP_DB);

  process.env.JUKU_BLOG_DB_PATH = TMP_DB;
  delete require.cache[require.resolve('../scripts/lib/db')];
  const { getDb, closeDb } = require('../scripts/lib/db');

  const db = getDb();

  const tableDef = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'seo_competitor_pages'").get();
  assert.ok(!tableDef.sql.includes('pre_branch_id'), '修復後はFOREIGN KEY定義にpre_branch_idが残っていないこと');
  assert.match(tableDef.sql, /REFERENCES seo_competitors\(id\)/, '正しいテーブル名(seo_competitors)を参照していること');

  // 修復前から存在していたデータが消えずに残っていること
  const existing = db.prepare("SELECT * FROM seo_competitor_pages WHERE canonical_url = 'https://www.itto.jp/school/amamiwa/'").get();
  assert.ok(existing, '修復前から存在していたページデータが保持されていること');
  assert.equal(existing.content_hash, 'hash1');

  // 修復後、実際にクロールが行うのと同じ新規INSERTが成功すること
  // (修復前はここで「no such table: main.seo_competitors_pre_branch_id」になっていた)
  assert.doesNotThrow(() => {
    db.prepare(
      `INSERT INTO seo_competitor_pages (competitor_id, url, canonical_url, content_hash, fetched_at, created_at, updated_at)
       VALUES ('itto.jp', 'https://www.itto.jp/', 'https://www.itto.jp/', 'hash2', '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z')`
    ).run();
  });

  closeDb();
  delete process.env.JUKU_BLOG_DB_PATH;
});

test('getDb(): 破損が無い正常なDBに対しては何もしない(冪等・無害)', () => {
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    // 既に無ければ無視
  }

  process.env.JUKU_BLOG_DB_PATH = TMP_DB;
  delete require.cache[require.resolve('../scripts/lib/db')];
  const { getDb, closeDb } = require('../scripts/lib/db');

  assert.doesNotThrow(() => getDb());
  const db = getDb();
  const broken = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE '%pre_branch_id%'").all();
  assert.equal(broken.length, 0);

  closeDb();
  delete process.env.JUKU_BLOG_DB_PATH;
});
