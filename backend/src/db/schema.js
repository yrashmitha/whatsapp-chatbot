/**
 * @module db/schema
 * @description Database schema initialisation and migrations.
 * Call init() once at startup to ensure all tables and columns exist.
 */

'use strict';

const { pool, db, IS_PG } = require('./connection');

/**
 * Create all required tables and run incremental migrations.
 * Safe to call on every startup — all statements are idempotent.
 *
 * @returns {Promise<void>}
 */
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

      -- Backfill messages.client_id from customers table where null
      UPDATE messages m SET client_id = c.client_id
      FROM customers c WHERE c.phone_number = m.phone_number AND m.client_id IS NULL AND c.client_id IS NOT NULL;
    `);

    // ── Dynamic order fields migration ──────────────────────────────────────
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='client_configs' AND column_name='order_fields') THEN
          ALTER TABLE client_configs ADD COLUMN order_fields JSONB NOT NULL DEFAULT '[]';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='client_configs' AND column_name='contact_number') THEN
          ALTER TABLE client_configs ADD COLUMN contact_number TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='custom_fields') THEN
          ALTER TABLE orders ADD COLUMN custom_fields JSONB;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='notes') THEN
          ALTER TABLE orders ADD COLUMN notes TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='ai_summary') THEN
          ALTER TABLE orders ADD COLUMN ai_summary TEXT;
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

    // ── Knowledge base ───────────────────────────────────────────────────────
    await pool.query(`
      ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS knowledge_base_enabled BOOLEAN NOT NULL DEFAULT FALSE;
      CREATE TABLE IF NOT EXISTS client_knowledge_chunks (
        id         SERIAL PRIMARY KEY,
        client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        title      TEXT NOT NULL,
        content    TEXT NOT NULL,
        embedding  VECTOR(768),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_embedding
        ON client_knowledge_chunks USING hnsw (embedding vector_cosine_ops);
      CREATE INDEX IF NOT EXISTS idx_knowledge_client
        ON client_knowledge_chunks (client_id);
    `);

    // ── media_type / media_url / wamid / is_deleted columns on messages ──────
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type TEXT`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url  TEXT`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS wamid TEXT`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE`);

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

    // ── Per-chat AI mode ─────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customer_settings (
        phone_number TEXT    NOT NULL,
        client_id    TEXT    NOT NULL,
        ai_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
        PRIMARY KEY (phone_number, client_id)
      );
    `);

    // ── Media library ─────────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS client_media (
        id          SERIAL PRIMARY KEY,
        client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        title       TEXT NOT NULL,
        description TEXT NOT NULL,
        image_url   TEXT NOT NULL,
        sort_order  INT NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_client_media_client ON client_media (client_id, sort_order);
    `);
    // ── Plugin system ──────────────────────────────────────────────────────────
    await pool.query(`ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS plugin_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
    // ── Unread message tracking ───────────────────────────────────────────────
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ`);
    // ── Addon system ──────────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS client_addons (
        client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        addon_id   TEXT NOT NULL,
        enabled    BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (client_id, addon_id)
      );
    `);
    // ── Plugin config + customer data ─────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS plugin_configs (
        client_id  TEXT NOT NULL,
        plugin_id  TEXT NOT NULL,
        config     JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (client_id, plugin_id)
      );
      CREATE TABLE IF NOT EXISTS plugin_customer_data (
        client_id    TEXT NOT NULL,
        phone_number TEXT NOT NULL,
        plugin_id    TEXT NOT NULL,
        data         JSONB NOT NULL DEFAULT '{}',
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (client_id, phone_number, plugin_id)
      );
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
    try { db.exec(`ALTER TABLE messages ADD COLUMN media_type TEXT`); } catch (_) {}
    try { db.exec(`ALTER TABLE messages ADD COLUMN media_url TEXT`); } catch (_) {}
    try { db.exec(`ALTER TABLE messages ADD COLUMN wamid TEXT`); } catch (_) {}
    try { db.exec(`ALTER TABLE messages ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0`); } catch (_) {}
    try { db.exec(`ALTER TABLE orders ADD COLUMN horoscope_received INTEGER NOT NULL DEFAULT 0`); } catch (_) {}
    try { db.exec(`ALTER TABLE orders ADD COLUMN receipt_received INTEGER NOT NULL DEFAULT 0`); } catch (_) {}
    try { db.exec(`ALTER TABLE orders ADD COLUMN notes TEXT`); } catch (_) {}
    try { db.exec(`ALTER TABLE orders ADD COLUMN ai_summary TEXT`); } catch (_) {}

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
    try { db.exec(`ALTER TABLE client_configs ADD COLUMN contact_number TEXT`); } catch (_) {}
    try { db.exec(`ALTER TABLE client_configs ADD COLUMN plugin_enabled INTEGER NOT NULL DEFAULT 0`); } catch (_) {}
    try { db.exec(`ALTER TABLE customers ADD COLUMN last_read_at TEXT`); } catch (_) {}
    // SQLite cannot DROP columns — old columns (package, birth_date, etc.) remain but are ignored

    // ── Per-chat AI mode (SQLite) ────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS customer_settings (
        phone_number TEXT    NOT NULL,
        client_id    TEXT    NOT NULL,
        ai_enabled   INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (phone_number, client_id)
      );
    `);

    // ── Media library (SQLite) ────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS client_media (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id   TEXT NOT NULL,
        title       TEXT NOT NULL,
        description TEXT NOT NULL,
        image_url   TEXT NOT NULL,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    // ── Plugin config + customer data (SQLite) ────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS plugin_configs (
        client_id  TEXT NOT NULL,
        plugin_id  TEXT NOT NULL,
        config     TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (client_id, plugin_id)
      );
      CREATE TABLE IF NOT EXISTS plugin_customer_data (
        client_id    TEXT NOT NULL,
        phone_number TEXT NOT NULL,
        plugin_id    TEXT NOT NULL,
        data         TEXT NOT NULL DEFAULT '{}',
        updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (client_id, phone_number, plugin_id)
      );
    `);
  }
}

module.exports = { init };
