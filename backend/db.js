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
        id                  SERIAL PRIMARY KEY,
        order_id            TEXT UNIQUE NOT NULL,
        phone_number        TEXT NOT NULL REFERENCES customers(phone_number) ON DELETE CASCADE,
        status              TEXT NOT NULL DEFAULT 'pending',
        horoscope_received  BOOLEAN NOT NULL DEFAULT FALSE,
        receipt_received    BOOLEAN NOT NULL DEFAULT FALSE,
        custom_fields       JSONB,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Migrate: add missing columns
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='cost_usd') THEN
          ALTER TABLE messages ADD COLUMN cost_usd NUMERIC(12,8);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='horoscope_received') THEN
          ALTER TABLE orders ADD COLUMN horoscope_received BOOLEAN NOT NULL DEFAULT FALSE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='receipt_received') THEN
          ALTER TABLE orders ADD COLUMN receipt_received BOOLEAN NOT NULL DEFAULT FALSE;
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

    // ── Multi-tenant tables ──────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        type       TEXT NOT NULL DEFAULT 'astrology',
        active     BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS client_configs (
        client_id                TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
        phone_number_id          TEXT,
        wa_token_env             TEXT,
        webhook_verify_token     TEXT,
        ai_model                 TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
        system_prompt_mode       TEXT NOT NULL DEFAULT 'builtin',
        custom_prompt            TEXT,
        temperature              NUMERIC(3,2) NOT NULL DEFAULT 0.70,
        brand_name               TEXT,
        brand_color              TEXT NOT NULL DEFAULT '#075e54',
        logo_url                 TEXT,
        order_id_prefix          TEXT UNIQUE DEFAULT 'ORD',
        product_catalog_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
        max_products_in_context  INT NOT NULL DEFAULT 10,
        catalog_search_mode      TEXT NOT NULL DEFAULT 'fts',
        order_flow_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
        admin_password_env       TEXT,
        updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS client_products (
        id          SERIAL PRIMARY KEY,
        client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        description TEXT,
        price       NUMERIC(12,2),
        price_max   NUMERIC(12,2),
        currency    TEXT NOT NULL DEFAULT 'LKR',
        category    TEXT,
        subcategory TEXT,
        sku         TEXT,
        image_url   TEXT,
        sort_order  INT NOT NULL DEFAULT 0,
        attributes  JSONB NOT NULL DEFAULT '{}',
        active      BOOLEAN NOT NULL DEFAULT TRUE,
        search_vec  TSVECTOR GENERATED ALWAYS AS (
          to_tsvector('english',
            coalesce(name,'') || ' ' || coalesce(description,'') || ' ' ||
            coalesce(category,'') || ' ' || coalesce(subcategory,'') || ' ' ||
            coalesce(sku,'') || ' ' || coalesce(attributes::text,'')
          )
        ) STORED,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_client_products_search     ON client_products USING GIN (search_vec);
      CREATE INDEX IF NOT EXISTS idx_client_products_attributes ON client_products USING GIN (attributes);
      CREATE INDEX IF NOT EXISTS idx_client_products_client     ON client_products (client_id, active);
      CREATE INDEX IF NOT EXISTS idx_client_products_category   ON client_products (client_id, category, active);
      CREATE TABLE IF NOT EXISTS client_attribute_schemas (
        id          SERIAL PRIMARY KEY,
        client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        field_key   TEXT NOT NULL,
        field_label TEXT NOT NULL,
        field_type  TEXT NOT NULL DEFAULT 'text',
        options     JSONB,
        unit        TEXT,
        filterable  BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order  INT NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(client_id, field_key)
      );
      CREATE INDEX IF NOT EXISTS idx_attr_schema_client ON client_attribute_schemas (client_id, sort_order);
    `);

    // qty column for products
    await pool.query(`ALTER TABLE client_products ADD COLUMN IF NOT EXISTS qty INT NOT NULL DEFAULT 0`);

    // pgvector extension + embedding column
    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS vector;
      ALTER TABLE client_products ADD COLUMN IF NOT EXISTS embedding VECTOR(768);
      CREATE INDEX IF NOT EXISTS idx_products_embedding
        ON client_products USING hnsw (embedding vector_cosine_ops);
    `);

    // No auto-seed — clients are created via /onboard.html
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='client_id') THEN
          ALTER TABLE customers ADD COLUMN client_id TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='client_id') THEN
          ALTER TABLE messages ADD COLUMN client_id TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='client_id') THEN
          ALTER TABLE orders ADD COLUMN client_id TEXT;
        END IF;
      END $$;

      CREATE INDEX IF NOT EXISTS idx_customers_client ON customers (client_id);
      CREATE INDEX IF NOT EXISTS idx_messages_client  ON messages  (client_id);
      CREATE INDEX IF NOT EXISTS idx_orders_client    ON orders    (client_id);

      -- Backfill orders.client_id from customers table where null
      UPDATE orders o SET client_id = c.client_id
      FROM customers c WHERE c.phone_number = o.phone_number AND o.client_id IS NULL AND c.client_id IS NOT NULL;
    `);

    // ── Dynamic order fields migration ──────────────────────────────────────
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='client_configs' AND column_name='order_fields') THEN
          ALTER TABLE client_configs ADD COLUMN order_fields JSONB NOT NULL DEFAULT '[]';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='custom_fields') THEN
          ALTER TABLE orders ADD COLUMN custom_fields JSONB;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='package') THEN
          ALTER TABLE orders DROP COLUMN package;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='birth_date') THEN
          ALTER TABLE orders DROP COLUMN birth_date;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='birth_time') THEN
          ALTER TABLE orders DROP COLUMN birth_time;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='birth_city') THEN
          ALTER TABLE orders DROP COLUMN birth_city;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='problems') THEN
          ALTER TABLE orders DROP COLUMN problems;
        END IF;
      END $$;
    `);

    // ── CRM auth tables ──────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS crm_users (
        id            SERIAL PRIMARY KEY,
        username      TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'client'
      );
      ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS crm_password_hash TEXT;
      ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS error_message TEXT;
      CREATE TABLE IF NOT EXISTS message_retry_queue (
        id           SERIAL PRIMARY KEY,
        phone_number TEXT NOT NULL,
        client_id    TEXT NOT NULL,
        message_text TEXT NOT NULL,
        attempts     INT NOT NULL DEFAULT 0,
        max_attempts INT NOT NULL DEFAULT 5,
        retry_after  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at  TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_retry_queue_pending
        ON message_retry_queue (retry_after) WHERE resolved_at IS NULL;
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
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id            TEXT UNIQUE NOT NULL,
        phone_number        TEXT NOT NULL REFERENCES customers(phone_number) ON DELETE CASCADE,
        status              TEXT NOT NULL DEFAULT 'pending',
        horoscope_received  INTEGER NOT NULL DEFAULT 0,
        receipt_received    INTEGER NOT NULL DEFAULT 0,
        custom_fields       TEXT,
        created_at          TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    // Migrate: add missing columns (existing DBs)
    try { db.exec(`ALTER TABLE messages ADD COLUMN cost_usd REAL`); } catch (_) {}
    try { db.exec(`ALTER TABLE orders ADD COLUMN horoscope_received INTEGER NOT NULL DEFAULT 0`); } catch (_) {}
    try { db.exec(`ALTER TABLE orders ADD COLUMN receipt_received INTEGER NOT NULL DEFAULT 0`); } catch (_) {}

    // ── Multi-tenant tables (SQLite) ─────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS clients (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        type       TEXT NOT NULL DEFAULT 'astrology',
        active     INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS client_configs (
        client_id                TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
        phone_number_id          TEXT,
        wa_token_env             TEXT,
        webhook_verify_token     TEXT,
        ai_model                 TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
        system_prompt_mode       TEXT NOT NULL DEFAULT 'builtin',
        custom_prompt            TEXT,
        temperature              REAL NOT NULL DEFAULT 0.70,
        brand_name               TEXT,
        brand_color              TEXT NOT NULL DEFAULT '#075e54',
        logo_url                 TEXT,
        order_id_prefix          TEXT UNIQUE DEFAULT 'ORD',
        product_catalog_enabled  INTEGER NOT NULL DEFAULT 0,
        max_products_in_context  INTEGER NOT NULL DEFAULT 10,
        catalog_search_mode      TEXT NOT NULL DEFAULT 'fts',
        order_flow_enabled       INTEGER NOT NULL DEFAULT 1,
        admin_password_env       TEXT,
        updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS client_products (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        description TEXT,
        price       REAL,
        price_max   REAL,
        currency    TEXT NOT NULL DEFAULT 'LKR',
        category    TEXT,
        subcategory TEXT,
        sku         TEXT,
        image_url   TEXT,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        attributes  TEXT NOT NULL DEFAULT '{}',
        active      INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS client_attribute_schemas (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        field_key   TEXT NOT NULL,
        field_label TEXT NOT NULL,
        field_type  TEXT NOT NULL DEFAULT 'text',
        options     TEXT,
        unit        TEXT,
        filterable  INTEGER NOT NULL DEFAULT 1,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(client_id, field_key)
      );
    `);

    // No auto-seed — clients are created via /onboard.html

    // Add client_id to existing tables
    try { db.exec(`ALTER TABLE customers ADD COLUMN client_id TEXT`); } catch (_) {}
    try { db.exec(`ALTER TABLE messages  ADD COLUMN client_id TEXT`); } catch (_) {}
    try { db.exec(`ALTER TABLE orders    ADD COLUMN client_id TEXT`); } catch (_) {}
    db.exec(`UPDATE customers SET client_id='astrology_001' WHERE client_id IS NULL`);
    db.exec(`UPDATE messages  SET client_id='astrology_001' WHERE client_id IS NULL`);
    db.exec(`UPDATE orders    SET client_id='astrology_001' WHERE client_id IS NULL`);
    // Dynamic order fields migration
    try { db.exec(`ALTER TABLE client_configs ADD COLUMN order_fields TEXT NOT NULL DEFAULT '[]'`); } catch (_) {}
    try { db.exec(`ALTER TABLE orders ADD COLUMN custom_fields TEXT`); } catch (_) {}
    // SQLite cannot DROP columns — old columns (package, birth_date, etc.) remain but are ignored
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function insertMessage(phoneNumber, text, senderType, costUsd = null) {
  if (IS_PG) {
    await pool.query(
      'INSERT INTO messages (phone_number, message_text, sender_type, cost_usd) VALUES ($1, $2, $3, $4)',
      [phoneNumber, text, senderType, costUsd]
    );
  } else {
    db.prepare('INSERT INTO messages (phone_number, message_text, sender_type, cost_usd) VALUES (?, ?, ?, ?)').run(phoneNumber, text, senderType, costUsd);
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

async function insertOrder(orderId, phoneNumber, clientId, customFields) {
  if (IS_PG) {
    await pool.query(
      'INSERT INTO orders (order_id, phone_number, client_id, custom_fields) VALUES ($1,$2,$3,$4)',
      [orderId, phoneNumber, clientId || null, customFields || null]
    );
  } else {
    db.prepare(
      'INSERT INTO orders (order_id, phone_number, client_id, custom_fields) VALUES (?,?,?,?)'
    ).run(orderId, phoneNumber, clientId || null, customFields ? JSON.stringify(customFields) : null);
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

async function getLatestOrder(phoneNumber) {
  if (IS_PG) {
    const res = await pool.query(
      'SELECT * FROM orders WHERE phone_number = $1 ORDER BY created_at DESC LIMIT 1',
      [phoneNumber]
    );
    return res.rows[0] || null;
  } else {
    return db.prepare('SELECT * FROM orders WHERE phone_number = ? ORDER BY created_at DESC LIMIT 1').get(phoneNumber) || null;
  }
}

async function updateOrderFlags(phoneNumber, flags) {
  // flags: { horoscope_received?, receipt_received? }
  const sets  = [];
  const vals  = [];
  if (flags.horoscope_received !== undefined) { sets.push(IS_PG ? `horoscope_received=$${sets.length+1}` : 'horoscope_received=?'); vals.push(flags.horoscope_received ? (IS_PG ? true : 1) : (IS_PG ? false : 0)); }
  if (flags.receipt_received   !== undefined) { sets.push(IS_PG ? `receipt_received=$${sets.length+1}`   : 'receipt_received=?');   vals.push(flags.receipt_received   ? (IS_PG ? true : 1) : (IS_PG ? false : 0)); }
  if (sets.length === 0) return;
  if (IS_PG) {
    vals.push(phoneNumber);
    await pool.query(
      `UPDATE orders SET ${sets.join(',')} WHERE id=(SELECT id FROM orders WHERE phone_number=$${vals.length} ORDER BY created_at DESC LIMIT 1)`,
      vals
    );
  } else {
    vals.push(phoneNumber);
    db.prepare(
      `UPDATE orders SET ${sets.join(',')} WHERE id=(SELECT id FROM orders WHERE phone_number=? ORDER BY created_at DESC LIMIT 1)`
    ).run(...vals);
  }
}

async function deleteCustomer(phoneNumber) {
  // CASCADE deletes messages + orders automatically
  if (IS_PG) {
    await pool.query('DELETE FROM customers WHERE phone_number = $1', [phoneNumber]);
  } else {
    db.prepare('DELETE FROM customers WHERE phone_number = ?').run(phoneNumber);
  }
}

async function deleteMessages(phoneNumber) {
  if (IS_PG) {
    await pool.query('DELETE FROM messages WHERE phone_number = $1', [phoneNumber]);
  } else {
    db.prepare('DELETE FROM messages WHERE phone_number = ?').run(phoneNumber);
  }
}

async function updateOrderFlagsById(orderId, flags) {
  const sets = [], vals = [];
  if (flags.horoscope_received !== undefined) {
    sets.push(IS_PG ? `horoscope_received=$${sets.length+1}` : 'horoscope_received=?');
    vals.push(flags.horoscope_received ? (IS_PG ? true : 1) : (IS_PG ? false : 0));
  }
  if (flags.receipt_received !== undefined) {
    sets.push(IS_PG ? `receipt_received=$${sets.length+1}` : 'receipt_received=?');
    vals.push(flags.receipt_received ? (IS_PG ? true : 1) : (IS_PG ? false : 0));
  }
  if (sets.length === 0) return;
  vals.push(orderId);
  if (IS_PG) {
    await pool.query(`UPDATE orders SET ${sets.join(',')} WHERE order_id=$${vals.length}`, vals);
  } else {
    db.prepare(`UPDATE orders SET ${sets.join(',')} WHERE order_id=?`).run(...vals);
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

// ─── Product catalog queries ───────────────────────────────────────────────────

/**
 * Full-text search across client products.
 * Falls back to returning empty array on SQLite (products are PG-only for now).
 */
async function searchProducts(clientId, query, limit = 10) {
  if (IS_PG) {
    if (!query || !query.trim()) {
      const res = await pool.query(
        `SELECT id, name, description, price, price_max, currency, category, subcategory, sku, image_url, attributes
         FROM client_products WHERE client_id = $1 AND active = TRUE
         ORDER BY sort_order, name LIMIT $2`,
        [clientId, limit]
      );
      return res.rows;
    }
    const res = await pool.query(
      `SELECT id, name, description, price, price_max, currency, category, subcategory, sku, image_url, attributes,
              ts_rank(search_vec, plainto_tsquery('english', $2)) AS rank
       FROM client_products WHERE client_id = $1 AND active = TRUE
         AND search_vec @@ plainto_tsquery('english', $2)
       ORDER BY rank DESC, sort_order LIMIT $3`,
      [clientId, query.trim(), limit]
    );
    return res.rows;
  } else {
    // SQLite: simple LIKE search
    const q = query ? `%${query.trim()}%` : null;
    const rows = q
      ? db.prepare(`SELECT id, name, description, price, price_max, currency, category, subcategory, sku, image_url, attributes
                    FROM client_products WHERE client_id = ? AND active = 1
                    AND (name LIKE ? OR description LIKE ? OR category LIKE ?) ORDER BY sort_order, name LIMIT ?`)
           .all(clientId, q, q, q, limit)
      : db.prepare(`SELECT id, name, description, price, price_max, currency, category, subcategory, sku, image_url, attributes
                    FROM client_products WHERE client_id = ? AND active = 1 ORDER BY sort_order, name LIMIT ?`)
           .all(clientId, limit);
    return rows.map(r => ({ ...r, attributes: JSON.parse(r.attributes || '{}') }));
  }
}

async function getAttributeSchema(clientId) {
  if (IS_PG) {
    const res = await pool.query(
      `SELECT field_key, field_label, field_type, options, unit, filterable
       FROM client_attribute_schemas WHERE client_id = $1 ORDER BY sort_order`,
      [clientId]
    );
    return res.rows;
  } else {
    const rows = db.prepare(
      `SELECT field_key, field_label, field_type, options, unit, filterable
       FROM client_attribute_schemas WHERE client_id = ? ORDER BY sort_order`
    ).all(clientId);
    return rows.map(r => ({ ...r, options: r.options ? JSON.parse(r.options) : null }));
  }
}

// ─── Vector search ────────────────────────────────────────────────────────────

async function vectorSearchProducts(clientId, embedding, limit = 10) {
  if (!IS_PG) return []; // pgvector not available on SQLite
  const res = await pool.query(
    `SELECT id, name, description, price, price_max, currency,
            category, subcategory, sku, image_url, attributes,
            1 - (embedding <=> $2::vector) AS similarity
     FROM client_products
     WHERE client_id = $1 AND active = TRUE AND embedding IS NOT NULL
     ORDER BY embedding <=> $2::vector
     LIMIT $3`,
    [clientId, JSON.stringify(embedding), limit]
  );
  return res.rows;
}

async function saveProductEmbedding(productId, embedding) {
  if (!IS_PG) return;
  await pool.query(
    `UPDATE client_products SET embedding = $1::vector WHERE id = $2`,
    [JSON.stringify(embedding), productId]
  );
}

// Raw query helper — PG uses pool, SQLite does a best-effort sync query
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

module.exports = { init, insertMessage, upsertCustomer, insertOrder, getOrdersByPhone, getLatestOrder, countOrdersByYear, getAllCustomers, getMessagesByPhone, updateLatestOrderStatus, updateOrderStatusById, updateOrderFlags, updateOrderFlagsById, deleteCustomer, deleteMessages, searchProducts, getAttributeSchema, vectorSearchProducts, saveProductEmbedding, IS_PG, pgQuery };
