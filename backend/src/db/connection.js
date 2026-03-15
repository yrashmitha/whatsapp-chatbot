/**
 * @module db/connection
 * @description Database connection layer.
 * Initialises either a PostgreSQL connection pool (production/Railway)
 * or a synchronous SQLite connection (local development).
 * Exports: pool, db, IS_PG, pgQuery
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const rawDbUrl = process.env.DATABASE_URL || '';
// Treat unresolved Railway template variables as no DB URL

/**
 * True when a valid PostgreSQL DATABASE_URL is present.
 * @type {boolean}
 */
const IS_PG = rawDbUrl.length > 0 && !rawDbUrl.includes('${{');

console.log(`[DB] DATABASE_URL set: ${!!rawDbUrl} | IS_PG: ${IS_PG}`);
if (rawDbUrl && rawDbUrl.includes('${{')) {
  console.warn(`[DB] DATABASE_URL contains unresolved Railway template vars — falling back to SQLite`);
}

/** @type {import('pg').Pool|undefined} PostgreSQL pool (production only) */
let pool;

/** @type {import('node:sqlite').DatabaseSync|undefined} SQLite handle (local dev only) */
let db;

if (IS_PG) {
  const { Pool } = require('pg');
  // Railway internal URLs don't need SSL; external ones do
  const needsSsl = rawDbUrl.includes('railway.app') || rawDbUrl.includes('railway.com') || rawDbUrl.includes('rlwy.net');
  pool = new Pool({
    connectionString: rawDbUrl,
    ssl: needsSsl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 10000,
  });
  console.log(`[DB] PostgreSQL pool created | SSL: ${needsSsl}`);
} else {
  const { DatabaseSync } = require('node:sqlite');
  const dataDir = path.join(__dirname, '../../data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
  db = new DatabaseSync(path.join(dataDir, 'chat.db'));
}

/**
 * Run a SQL query against whichever backend is active.
 * On PostgreSQL it uses the pool. On SQLite it translates $1/$2 params to ?
 * and executes synchronously, returning a { rows } object.
 *
 * @param {string}    sql    - SQL statement (may use $1/$2/… placeholders)
 * @param {Array}     [params] - Positional parameter values
 * @returns {Promise<{rows: Array}>}
 */
async function pgQuery(sql, params) {
  if (IS_PG) return pool.query(sql, params);
  // SQLite fallback: translate basic $1/$2 params to ? and run sync
  const sqlite_sql = sql.replace(/\$\d+/g, '?');
  try {
    const rows = db.prepare(sqlite_sql).all(...(params || []));
    return { rows };
  } catch (_) {
    return { rows: [] };
  }
}

module.exports = { pool, db, IS_PG, pgQuery };
