'use strict';

const { getDb, DB_PATH } = require('./lib/db');

getDb();
console.log(`[init_db] posts.sqlite を初期化/確認しました: ${DB_PATH}`);
