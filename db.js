const fs   = require('fs');
const path = require('path');

const IS_PG = !!process.env.DATABASE_URL;

let pool; // pg (Railway)
let db;   // SQLite (local)

if (IS_PG) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
} else {
  const { DatabaseSync } = require('node:sqlite');
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
  db = new DatabaseSync(path.join(dataDir, 'chat.db'));
}

// ─── Schema ───────────────────────────────────────────────────────────────────
async function init() {
  if (IS_PG) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id           SERIAL PRIMARY KEY,
        phone_number TEXT NOT NULL,
        message_text TEXT NOT NULL,
        sender_type  TEXT NOT NULL CHECK(sender_type IN ('user','bot')),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS customers (
        phone_number TEXT PRIMARY KEY,
        name         TEXT,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS orders (
        id           SERIAL PRIMARY KEY,
        order_id     TEXT UNIQUE NOT NULL,
        phone_number TEXT NOT NULL,
        package      TEXT,
        birth_date   TEXT,
        birth_time   TEXT,
        birth_city   TEXT,
        problems     TEXT,
        status       TEXT NOT NULL DEFAULT 'pending',
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  } else {
    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        phone_number TEXT NOT NULL,
        message_text TEXT NOT NULL,
        sender_type  TEXT NOT NULL CHECK(sender_type IN ('user','bot')),
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS customers (
        phone_number TEXT PRIMARY KEY,
        name         TEXT,
        updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS orders (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id     TEXT UNIQUE NOT NULL,
        phone_number TEXT NOT NULL,
        package      TEXT,
        birth_date   TEXT,
        birth_time   TEXT,
        birth_city   TEXT,
        problems     TEXT,
        status       TEXT NOT NULL DEFAULT 'pending',
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function insertMessage(phoneNumber, text, senderType) {
  if (IS_PG) {
    await pool.query(
      'INSERT INTO messages (phone_number, message_text, sender_type) VALUES ($1, $2, $3)',
      [phoneNumber, text, senderType]
    );
  } else {
    db.prepare('INSERT INTO messages (phone_number, message_text, sender_type) VALUES (?, ?, ?)').run(phoneNumber, text, senderType);
  }
}

async function upsertCustomer(phoneNumber, name) {
  if (IS_PG) {
    await pool.query(`
      INSERT INTO customers (phone_number, name, updated_at) VALUES ($1, $2, NOW())
      ON CONFLICT(phone_number) DO UPDATE SET
        name       = COALESCE(EXCLUDED.name, customers.name),
        updated_at = NOW()
    `, [phoneNumber, name]);
  } else {
    db.prepare(`
      INSERT INTO customers (phone_number, name, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(phone_number) DO UPDATE SET
        name       = COALESCE(excluded.name, name),
        updated_at = datetime('now')
    `).run(phoneNumber, name);
  }
}

async function insertOrder(orderId, phoneNumber, pkg, birthDate, birthTime, birthCity, problems) {
  if (IS_PG) {
    await pool.query(
      'INSERT INTO orders (order_id, phone_number, package, birth_date, birth_time, birth_city, problems) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [orderId, phoneNumber, pkg, birthDate, birthTime, birthCity, problems]
    );
  } else {
    db.prepare(
      'INSERT INTO orders (order_id, phone_number, package, birth_date, birth_time, birth_city, problems) VALUES (?,?,?,?,?,?,?)'
    ).run(orderId, phoneNumber, pkg, birthDate, birthTime, birthCity, problems);
  }
}

async function getOrdersByPhone(phoneNumber) {
  if (IS_PG) {
    const res = await pool.query(
      'SELECT * FROM orders WHERE phone_number = $1 ORDER BY created_at DESC',
      [phoneNumber]
    );
    return res.rows;
  } else {
    return db.prepare('SELECT * FROM orders WHERE phone_number = ? ORDER BY created_at DESC').all(phoneNumber);
  }
}

async function countOrdersByYear(pattern) {
  if (IS_PG) {
    const res = await pool.query(
      "SELECT COUNT(*) AS cnt FROM orders WHERE order_id LIKE $1",
      [pattern]
    );
    return parseInt(res.rows[0].cnt, 10);
  } else {
    const row = db.prepare("SELECT COUNT(*) as cnt FROM orders WHERE order_id LIKE ?").get(pattern);
    return row.cnt || 0;
  }
}

module.exports = { init, insertMessage, upsertCustomer, insertOrder, getOrdersByPhone, countOrdersByYear, IS_PG };
