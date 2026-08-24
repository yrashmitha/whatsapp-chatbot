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
      END $$;
    `);

    // ── Remove legacy pj-specific order columns ───────────────────────────────
    await pool.query(`
      ALTER TABLE orders DROP COLUMN IF EXISTS horoscope_received;
      ALTER TABLE orders DROP COLUMN IF EXISTS receipt_received;
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
    // Delivery receipts. Without these, a report that never arrived looks
    // exactly like one that did.
    // An operator's running log against an order, kept apart from `notes`,
    // which holds the AI summary and gets rewritten.
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS remarks JSONB NOT NULL DEFAULT '[]'::jsonb`);

    // Which follow-up was sent, so replies and payments afterwards can be
    // attributed to the approach that earned them.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS follow_up_sends (
        id           SERIAL PRIMARY KEY,
        client_id    TEXT NOT NULL,
        order_id     TEXT NOT NULL,
        phone_number TEXT NOT NULL,
        angle        TEXT,
        temp         TEXT,
        message      TEXT NOT NULL,
        edited       BOOLEAN NOT NULL DEFAULT FALSE,
        sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_follow_up_sends_client ON follow_up_sends (client_id, sent_at DESC)`);

    // Judging a conversation costs a model call, and the answer only changes
    // when the conversation does. Keyed on a fingerprint of exactly that, so an
    // unchanged conversation is never judged twice.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scheduled_follow_ups (
        id           SERIAL PRIMARY KEY,
        client_id    TEXT NOT NULL,
        order_id     TEXT NOT NULL,
        phone_number TEXT NOT NULL,
        message      TEXT NOT NULL,
        angle        TEXT,
        temp         TEXT,
        send_at      TIMESTAMPTZ NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending',
        outcome      TEXT,
        approved_by  TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at  TIMESTAMPTZ
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sched_due ON scheduled_follow_ups (status, send_at)`);
    // Customers are read in their own local time, not the server's.
    await pool.query(`ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS timezone TEXT`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS follow_up_judgements (
        client_id   TEXT NOT NULL,
        order_id    TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        temp        TEXT,
        why         TEXT,
        angle       TEXT,
        draft       TEXT,
        send_at     TEXT,
        when_why    TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (client_id, order_id)
      )`);
    await pool.query(`ALTER TABLE follow_up_judgements ADD COLUMN IF NOT EXISTS send_at TEXT`);
    await pool.query(`ALTER TABLE follow_up_judgements ADD COLUMN IF NOT EXISTS when_why TEXT`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_status TEXT`);
    // The list or buttons that were sent, so the CRM can draw the real thing.
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS interactive JSONB`);
    // What the vision pass read out of an attachment, so the CRM can show it
    // instead of an operator having to open the file and check by hand.
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS extracted JSONB`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS error_code INT`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS error_message TEXT`);
    // Every status callback looks a message up by wamid, several per message.
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_wamid ON messages(wamid) WHERE wamid IS NOT NULL`);
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
    // ── 24h window tracking (customer messages only) ──────────────────────────
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_customer_message_at TIMESTAMPTZ`);
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
    // ── Horoscope reading data ────────────────────────────────────────────────
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS horoscope_data JSONB`);
    // ── Tarot reading data ────────────────────────────────────────────────────
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS tarot_data JSONB`);

    // ── Global AI kill switch per client ─────────────────────────────────────
    await pool.query(`ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT TRUE`);
    // ── Per-client token storage (no restart needed for new clients) ──────────
    await pool.query(`ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS wa_token TEXT`);
    await pool.query(`ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS gemini_api_key TEXT`);
    await pool.query(`ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS use_system_wa_token BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS use_system_gemini_key BOOLEAN NOT NULL DEFAULT FALSE`);
    // ── Per-client freeastroapi key (mirrors the Gemini pair above) ───────────
    // Previously lived in plugin_configs.config->>'api_key', a generic field name
    // shared with unrelated plugins. Promoted here so report generation bills the
    // client's own account rather than the platform's.
    // The one-time migration below must not re-run on later boots, or it would
    // silently undo an admin who deliberately turned the system-key opt-in off.
    // Detect a genuinely fresh column rather than relying on ADD COLUMN IF NOT EXISTS.
    const freeastroCol = await pool.query(`
      SELECT 1 FROM information_schema.columns
       WHERE table_name = 'client_configs' AND column_name = 'freeastro_api_key'
    `);
    const freeastroIsNew = freeastroCol.rows.length === 0;
    await pool.query(`ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS freeastro_api_key TEXT`);
    await pool.query(`ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS use_system_freeastro_key BOOLEAN NOT NULL DEFAULT FALSE`);
    if (freeastroIsNew) {
      // Move any key already stored under the old plugin_configs.config->>'api_key'.
      await pool.query(`
        UPDATE client_configs cc
           SET freeastro_api_key = pc.config->>'api_key'
          FROM plugin_configs pc
         WHERE pc.client_id = cc.client_id
           AND pc.plugin_id = 'horoscope_reading'
           AND COALESCE(pc.config->>'api_key', '') <> ''
      `);
      // Clients that predate per-client keys keep running on the platform key,
      // but from now on by explicit opt-in rather than a silent fallback.
      await pool.query(`
        UPDATE client_configs
           SET use_system_freeastro_key = (freeastro_api_key IS NULL),
               use_system_gemini_key    = use_system_gemini_key OR (gemini_api_key IS NULL)
      `);
      console.log('[SCHEMA] freeastro_api_key added; migrated existing keys and set system-key opt-ins');
    }

    // ── Per-client report branding ───────────────────────────────────────────
    // Nothing here has a default: an unset field renders as nothing rather than
    // inheriting another client's identity. See services/branding.js.
    for (const col of [
      'report_signature TEXT', 'report_footer TEXT', 'report_invocation TEXT',
      'report_divider TEXT', 'report_font TEXT', 'report_logo_url TEXT',
      'pdf_title TEXT', 'pdf_author TEXT', 'pdf_subject TEXT', 'pdf_producer TEXT',
    ]) {
      await pool.query(`ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS ${col}`);
    }
    // Draft system prompt, applied to Test Chat sessions only so a prompt can
    // be tried against real behaviour without changing what customers get.
    await pool.query(`ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS test_system_prompt TEXT`);
    // Named interactive-list menus the bot can send with [[LIST:<id>]].
    await pool.query(`ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS interactive_menus JSONB`);
    // NULL means 'use the platform default'. 0 means reasoning off, which is
    // the right setting for a prompt that already scripts the whole flow.
    await pool.query(`ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS thinking_budget INT`);
    await pool.query(`ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS report_logo_width  INT NOT NULL DEFAULT 160`);
    await pool.query(`ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS report_logo_height INT NOT NULL DEFAULT 160`);

    // ── Backfill addons that replaced hardcoded gating ───────────────────────
    // match_making and income_summary used to be decided by client ID in code.
    // Grant them to whichever clients already have the horoscope addon so the
    // switch to data-driven entitlement is not a feature removal. Idempotent,
    // and ON CONFLICT DO NOTHING means a later boot cannot re-enable something
    // an admin has since turned off.
    await pool.query(`
      INSERT INTO client_addons (client_id, addon_id, enabled)
      SELECT ca.client_id, a.addon_id, TRUE
        FROM client_addons ca
        CROSS JOIN (VALUES ('match_making'), ('income_summary')) AS a(addon_id)
       WHERE ca.addon_id = 'horoscope_reading' AND ca.enabled = TRUE
      ON CONFLICT (client_id, addon_id) DO NOTHING
    `);

    // ── Quick replies ─────────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quick_replies (
        id         SERIAL PRIMARY KEY,
        client_id  TEXT NOT NULL,
        title      TEXT NOT NULL,
        text       TEXT NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_quick_replies_client ON quick_replies (client_id, sort_order);
    `);

    // ── AI Call Answering ─────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS calls (
        id               SERIAL PRIMARY KEY,
        call_sid         TEXT UNIQUE NOT NULL,
        client_id        TEXT NOT NULL,
        caller_phone     TEXT NOT NULL,
        called_phone     TEXT NOT NULL,
        status           TEXT NOT NULL DEFAULT 'in-progress',
        duration_seconds INT,
        transcript       JSONB NOT NULL DEFAULT '[]',
        ai_summary       TEXT,
        started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at         TIMESTAMPTZ,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_calls_client_id  ON calls(client_id);
      CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at DESC);
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

    // ── Packages ──────────────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS packages (
        id               TEXT PRIMARY KEY,
        name             TEXT NOT NULL,
        message_limit    INT NOT NULL,
        per_message_cost NUMERIC(10,6) NOT NULL DEFAULT 0,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── Package billing fields on client_configs ──────────────────────────────
    await pool.query(`
      ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS package_id        TEXT REFERENCES packages(id) DEFAULT NULL;
      ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS bonus_messages    INT NOT NULL DEFAULT 0;
      ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS overage_limit     INT NOT NULL DEFAULT 0;
      ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS per_message_cost  NUMERIC(10,6) NOT NULL DEFAULT 0;
    `);

    // ── Nova Consult (public web chat) ────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS consult_config (
        id            INT PRIMARY KEY DEFAULT 1 CHECK(id = 1),
        system_prompt TEXT,
        max_sessions  INT NOT NULL DEFAULT 10,
        max_messages  INT NOT NULL DEFAULT 50,
        access_code   TEXT,
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      );
      INSERT INTO consult_config (id) VALUES (1) ON CONFLICT DO NOTHING;
      ALTER TABLE consult_config ADD COLUMN IF NOT EXISTS max_messages INT NOT NULL DEFAULT 50;

      CREATE TABLE IF NOT EXISTS consult_sessions (
        id            SERIAL PRIMARY KEY,
        session_token TEXT UNIQUE NOT NULL,
        name          TEXT,
        business_name TEXT,
        business_type TEXT,
        phone         TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS consult_messages (
        id         SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES consult_sessions(id) ON DELETE CASCADE,
        role       TEXT NOT NULL CHECK(role IN ('user','model')),
        text       TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_consult_messages_session ON consult_messages (session_id, created_at);
    `);

    // ── Owner/admin notification phone ────────────────────────────────────────
    await pool.query(`ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS owner_phone TEXT`);

    // ── Fallback attention flag ───────────────────────────────────────────────
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS needs_attention BOOLEAN NOT NULL DEFAULT FALSE`);

    // ── Voice clips library ───────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS voice_clips (
        id               SERIAL PRIMARY KEY,
        client_id        TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        name             TEXT NOT NULL,
        trigger_keyword  TEXT NOT NULL,
        audio_url        TEXT NOT NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(client_id, trigger_keyword)
      );
      CREATE INDEX IF NOT EXISTS idx_voice_clips_client ON voice_clips (client_id);
    `);

    // ── Meta CAPI event log ───────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS meta_capi_log (
        id          SERIAL PRIMARY KEY,
        client_id   TEXT NOT NULL,
        event_name  TEXT NOT NULL,
        phone_last4 TEXT,
        status      TEXT NOT NULL CHECK(status IN ('ok','error')),
        detail      TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_meta_capi_log_client ON meta_capi_log (client_id, created_at DESC);
    `);

    // ── Astro chart cache (dedupe freeastroapi calls by birth params) ─────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS astro_cache (
        birth_hash  TEXT PRIMARY KEY,
        response    JSONB NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // teaser_si: cached AI-written teaser reading (one Gemini call per unique
    // birth chart, reused on every subsequent view of the same chart).
    await pool.query(`ALTER TABLE astro_cache ADD COLUMN IF NOT EXISTS teaser_si TEXT`);

    // ── Match (Ashtakoota compatibility) cache — dedupe freeastroapi calls ────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS match_cache (
        match_hash  TEXT PRIMARY KEY,
        response    JSONB NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── Deep match analysis cache (Gemini classification + narrative) ────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS match_deep_cache (
        match_hash  TEXT PRIMARY KEY,
        response    JSONB NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
        custom_fields       TEXT,
        created_at          TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    // Migrate: add missing columns (existing DBs)
    try { db.exec(`ALTER TABLE messages ADD COLUMN cost_usd REAL`); } catch (_) {}
    try { db.exec(`ALTER TABLE messages ADD COLUMN media_type TEXT`); } catch (_) {}
    try { db.exec(`ALTER TABLE messages ADD COLUMN media_url TEXT`); } catch (_) {}
    try { db.exec(`ALTER TABLE messages ADD COLUMN wamid TEXT`); } catch (_) {}
    try { db.exec(`ALTER TABLE messages ADD COLUMN delivery_status TEXT`); } catch (_) {}
    try { db.exec(`ALTER TABLE messages ADD COLUMN interactive TEXT`); } catch (_) {}
    try { db.exec(`ALTER TABLE messages ADD COLUMN extracted TEXT`); } catch (_) {}
    try { db.exec(`ALTER TABLE messages ADD COLUMN delivered_at TEXT`); } catch (_) {}
    try { db.exec(`ALTER TABLE messages ADD COLUMN read_at TEXT`); } catch (_) {}
    try { db.exec(`ALTER TABLE messages ADD COLUMN error_code INTEGER`); } catch (_) {}
    try { db.exec(`ALTER TABLE messages ADD COLUMN error_message TEXT`); } catch (_) {}
    try { db.exec(`ALTER TABLE messages ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0`); } catch (_) {}
    // NOTE: SQLite cannot DROP columns — horoscope_received and receipt_received are ignored if present
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
    // Local SQLite dev only: adopt pre-tenancy rows under the neutral dev client
    // rather than assigning them to a real tenant.
    db.exec(`UPDATE customers SET client_id='local_dev' WHERE client_id IS NULL`);
    db.exec(`UPDATE messages  SET client_id='local_dev' WHERE client_id IS NULL`);
    db.exec(`UPDATE orders    SET client_id='local_dev' WHERE client_id IS NULL`);
    // Dynamic order fields migration
    try { db.exec(`ALTER TABLE client_configs ADD COLUMN order_fields TEXT NOT NULL DEFAULT '[]'`); } catch (_) {}
    try { db.exec(`ALTER TABLE orders ADD COLUMN custom_fields TEXT`); } catch (_) {}
    try { db.exec(`ALTER TABLE client_configs ADD COLUMN contact_number TEXT`); } catch (_) {}
    try { db.exec(`ALTER TABLE client_configs ADD COLUMN plugin_enabled INTEGER NOT NULL DEFAULT 0`); } catch (_) {}
    try { db.exec(`ALTER TABLE customers ADD COLUMN last_read_at TEXT`); } catch (_) {}
    try { db.exec(`ALTER TABLE customers ADD COLUMN last_customer_message_at TEXT`); } catch (_) {}
    try { db.exec(`ALTER TABLE client_configs ADD COLUMN ai_enabled INTEGER NOT NULL DEFAULT 1`); } catch (_) {}
    try { db.exec(`ALTER TABLE client_configs ADD COLUMN wa_token TEXT`); } catch (_) {}
    try { db.exec(`ALTER TABLE client_configs ADD COLUMN gemini_api_key TEXT`); } catch (_) {}
    try { db.exec(`ALTER TABLE client_configs ADD COLUMN use_system_wa_token INTEGER NOT NULL DEFAULT 0`); } catch (_) {}
    try { db.exec(`ALTER TABLE client_configs ADD COLUMN use_system_gemini_key INTEGER NOT NULL DEFAULT 0`); } catch (_) {}
    try { db.exec(`ALTER TABLE client_configs ADD COLUMN freeastro_api_key TEXT`); } catch (_) {}
    try { db.exec(`ALTER TABLE client_configs ADD COLUMN use_system_freeastro_key INTEGER NOT NULL DEFAULT 0`); } catch (_) {}
    for (const col of [
      'report_signature TEXT', 'report_footer TEXT', 'report_invocation TEXT',
      'report_divider TEXT', 'report_font TEXT', 'report_logo_url TEXT',
      'pdf_title TEXT', 'pdf_author TEXT', 'pdf_subject TEXT', 'pdf_producer TEXT',
      'test_system_prompt TEXT',
      'interactive_menus TEXT',
      'thinking_budget INTEGER',
      'report_logo_width INTEGER NOT NULL DEFAULT 160',
      'report_logo_height INTEGER NOT NULL DEFAULT 160',
    ]) {
      try { db.exec(`ALTER TABLE client_configs ADD COLUMN ${col}`); } catch (_) {}
    }
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
    // ── Horoscope reading data (SQLite) ──────────────────────────────────────
    try { db.exec(`ALTER TABLE orders ADD COLUMN horoscope_data TEXT`); } catch (_) {}
    // ── Tarot reading data (SQLite) ───────────────────────────────────────────
    try { db.exec(`ALTER TABLE orders ADD COLUMN tarot_data TEXT`); } catch (_) {}

    // ── Astro chart cache (dedupe freeastroapi calls by birth params) ─────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS astro_cache (
        birth_hash  TEXT PRIMARY KEY,
        response    TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    try { db.exec(`ALTER TABLE astro_cache ADD COLUMN teaser_si TEXT`); } catch (_) {}

    // ── Match (Ashtakoota compatibility) cache (SQLite) ──────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS match_cache (
        match_hash  TEXT PRIMARY KEY,
        response    TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // ── Deep match analysis cache (SQLite) ───────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS match_deep_cache (
        match_hash  TEXT PRIMARY KEY,
        response    TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // ── Voice clips library (SQLite) ─────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS voice_clips (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id       TEXT NOT NULL,
        name            TEXT NOT NULL,
        trigger_keyword TEXT NOT NULL,
        audio_url       TEXT NOT NULL,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(client_id, trigger_keyword)
      );
    `);

    // ── Quick replies (SQLite) ────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS quick_replies (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id  TEXT NOT NULL,
        title      TEXT NOT NULL,
        text       TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

    // ── Packages (SQLite) ─────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS packages_local (
        id               TEXT PRIMARY KEY,
        name             TEXT NOT NULL,
        message_limit    INTEGER NOT NULL,
        per_message_cost REAL NOT NULL DEFAULT 0,
        created_at       TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // ── Package billing fields on client_configs (SQLite) ─────────────────────
    try { db.exec(`ALTER TABLE client_configs ADD COLUMN package_id       TEXT DEFAULT NULL`); } catch (_) {}
    try { db.exec(`ALTER TABLE client_configs ADD COLUMN bonus_messages   INTEGER NOT NULL DEFAULT 0`); } catch (_) {}
    try { db.exec(`ALTER TABLE client_configs ADD COLUMN overage_limit    INTEGER NOT NULL DEFAULT 0`); } catch (_) {}
    try { db.exec(`ALTER TABLE client_configs ADD COLUMN per_message_cost REAL NOT NULL DEFAULT 0`); } catch (_) {}
  }
}

module.exports = { init };
