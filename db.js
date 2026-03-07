const fs   = require('fs');
const path = require('path');

const rawDbUrl = process.env.DATABASE_URL || '';
// Treat unresolved Railway template variables as no DB URL
const IS_PG = rawDbUrl.length > 0 && !rawDbUrl.includes('${{');

console.log(`[DB] DATABASE_URL set: ${!!rawDbUrl} | IS_PG: ${IS_PG}`);
if (rawDbUrl && rawDbUrl.includes('${{')) {
  console.warn(`[DB] DATABASE_URL contains unresolved Railway template vars — falling back to SQLite`);
}

let pool; // pg (Railway)
let db;   // SQLite (local)

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
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
  db = new DatabaseSync(path.join(dataDir, 'chat.db'));
}

// ─── Schema ───────────────────────────────────────────────────────────────────
async function init() {
  if (IS_PG) {
    // customers must exist before messages/orders reference it
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        phone_number TEXT PRIMARY KEY,
        name         TEXT,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS messages (
        id           SERIAL PRIMARY KEY,
        phone_number TEXT NOT NULL REFERENCES customers(phone_number) ON DELETE CASCADE,
        message_text TEXT NOT NULL,
        sender_type  TEXT NOT NULL CHECK(sender_type IN ('user','bot')),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS orders (
        id           SERIAL PRIMARY KEY,
        order_id     TEXT UNIQUE NOT NULL,
        phone_number TEXT NOT NULL REFERENCES customers(phone_number) ON DELETE CASCADE,
        package      TEXT,
        birth_date   TEXT,
        birth_time   TEXT,
        birth_city   TEXT,
        problems     TEXT,
        status       TEXT NOT NULL DEFAULT 'pending',
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Migrate: add cost_usd column if missing
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'messages' AND column_name = 'cost_usd'
        ) THEN
          ALTER TABLE messages ADD COLUMN cost_usd NUMERIC(12,8);
        END IF;
      END $$;
    `);

    // Migrate existing deployments: backfill missing customers, then add FK constraints
    await pool.query(`
      -- Insert a customer row for any phone that has messages/orders but no customer record
      INSERT INTO customers (phone_number)
        SELECT DISTINCT phone_number FROM messages
        WHERE phone_number NOT IN (SELECT phone_number FROM customers)
      ON CONFLICT DO NOTHING;

      INSERT INTO customers (phone_number)
        SELECT DISTINCT phone_number FROM orders
        WHERE phone_number NOT IN (SELECT phone_number FROM customers)
      ON CONFLICT DO NOTHING;

      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'fk_messages_customer' AND table_name = 'messages'
        ) THEN
          ALTER TABLE messages ADD CONSTRAINT fk_messages_customer
            FOREIGN KEY (phone_number) REFERENCES customers(phone_number) ON DELETE CASCADE;
        END IF;
      END $$;
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'fk_orders_customer' AND table_name = 'orders'
        ) THEN
          ALTER TABLE orders ADD CONSTRAINT fk_orders_customer
            FOREIGN KEY (phone_number) REFERENCES customers(phone_number) ON DELETE CASCADE;
        END IF;
      END $$;
    `);
  } else {
    db.exec(`PRAGMA foreign_keys = ON;`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS customers (
        phone_number TEXT PRIMARY KEY,
        name         TEXT,
        updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS messages (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        phone_number TEXT NOT NULL REFERENCES customers(phone_number) ON DELETE CASCADE,
        message_text TEXT NOT NULL,
        sender_type  TEXT NOT NULL CHECK(sender_type IN ('user','bot')),
        cost_usd     REAL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS orders (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id     TEXT UNIQUE NOT NULL,
        phone_number TEXT NOT NULL REFERENCES customers(phone_number) ON DELETE CASCADE,
        package      TEXT,
        birth_date   TEXT,
        birth_time   TEXT,
        birth_city   TEXT,
        problems     TEXT,
        status       TEXT NOT NULL DEFAULT 'pending',
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    // Migrate: add cost_usd column if missing (existing DBs)
    try { db.exec(`ALTER TABLE messages ADD COLUMN cost_usd REAL`); } catch (_) {}
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

async function getAllCustomers() {
  if (IS_PG) {
    const res = await pool.query(`
      SELECT
        c.phone_number, c.name,
        MAX(m.created_at) AS last_seen,
        COUNT(DISTINCT m.id)::int AS msg_count,
        COUNT(DISTINCT o.id)::int AS order_count
      FROM customers c
      LEFT JOIN messages m ON m.phone_number = c.phone_number
      LEFT JOIN orders   o ON o.phone_number = c.phone_number
      GROUP BY c.phone_number, c.name
      ORDER BY last_seen DESC NULLS LAST
    `);
    return res.rows;
  } else {
    return db.prepare(`
      SELECT
        c.phone_number, c.name,
        MAX(m.created_at) AS last_seen,
        COUNT(DISTINCT m.id) AS msg_count,
        COUNT(DISTINCT o.id) AS order_count
      FROM customers c
      LEFT JOIN messages m ON m.phone_number = c.phone_number
      LEFT JOIN orders   o ON o.phone_number = c.phone_number
      GROUP BY c.phone_number, c.name
      ORDER BY last_seen DESC
    `).all();
  }
}

async function getMessagesByPhone(phoneNumber) {
  if (IS_PG) {
    const res = await pool.query(
      'SELECT * FROM messages WHERE phone_number = $1 ORDER BY created_at ASC',
      [phoneNumber]
    );
    return res.rows;
  } else {
    return db.prepare('SELECT * FROM messages WHERE phone_number = ? ORDER BY created_at ASC').all(phoneNumber);
  }
}

async function updateOrderStatusById(orderId, status) {
  if (IS_PG) {
    await pool.query('UPDATE orders SET status = $1 WHERE order_id = $2', [status, orderId]);
  } else {
    db.prepare('UPDATE orders SET status = ? WHERE order_id = ?').run(status, orderId);
  }
}

async function updateLatestOrderStatus(phoneNumber, status) {
  if (IS_PG) {
    await pool.query(
      `UPDATE orders SET status = $1
       WHERE id = (SELECT id FROM orders WHERE phone_number = $2 ORDER BY created_at DESC LIMIT 1)`,
      [status, phoneNumber]
    );
  } else {
    db.prepare(
      `UPDATE orders SET status = ?
       WHERE id = (SELECT id FROM orders WHERE phone_number = ? ORDER BY created_at DESC LIMIT 1)`
    ).run(status, phoneNumber);
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

module.exports = { init, insertMessage, upsertCustomer, insertOrder, getOrdersByPhone, countOrdersByYear, getAllCustomers, getMessagesByPhone, updateLatestOrderStatus, updateOrderStatusById, IS_PG };
