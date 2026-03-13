-- ============================================================
-- migrate_v2.sql  —  Multi-tenant schema migration
-- Safe to run multiple times (fully idempotent)
-- Run BEFORE deploying Phase 2+ code
-- ============================================================

BEGIN;

-- ─── 1. clients ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id         TEXT PRIMARY KEY,                    -- e.g. 'astrology_001', 'shop_001'
  name       TEXT NOT NULL,                       -- display name
  type       TEXT NOT NULL DEFAULT 'astrology',   -- 'astrology' | 'ecommerce' | 'general'
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2. client_configs ───────────────────────────────────────────────────────
-- Tokens stored as ENV VAR NAMES (not values) for security
CREATE TABLE IF NOT EXISTS client_configs (
  client_id                TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  -- WhatsApp
  phone_number_id          TEXT,            -- Meta phone number ID for this client
  wa_token_env             TEXT,            -- name of env var holding the WA access token
  webhook_verify_token     TEXT,            -- webhook verification token
  -- AI
  ai_model                 TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
  system_prompt_mode       TEXT NOT NULL DEFAULT 'builtin',  -- 'builtin' | 'custom'
  custom_prompt            TEXT,            -- used when system_prompt_mode = 'custom'
  temperature              NUMERIC(3,2) NOT NULL DEFAULT 0.70,
  -- Branding
  brand_name               TEXT,
  brand_color              TEXT NOT NULL DEFAULT '#075e54',
  logo_url                 TEXT,
  -- Order ID (UNIQUE — no two clients share a prefix)
  order_id_prefix          TEXT UNIQUE DEFAULT 'ORD',  -- e.g. 'PJ', 'SHOP', 'REST'
  -- Product catalog
  product_catalog_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
  max_products_in_context  INT NOT NULL DEFAULT 10,
  catalog_search_mode      TEXT NOT NULL DEFAULT 'fts',  -- 'fts' | 'ai_sql'
  order_flow_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  -- Admin
  admin_password_env       TEXT,            -- name of env var holding the admin password
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 3. client_products ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_products (
  id          SERIAL PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  price       NUMERIC(12,2),
  price_max   NUMERIC(12,2),               -- for price ranges e.g. 500-1500
  currency    TEXT NOT NULL DEFAULT 'LKR',
  category    TEXT,
  subcategory TEXT,
  sku         TEXT,                         -- product code for exact lookup
  image_url   TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  attributes  JSONB NOT NULL DEFAULT '{}', -- ALL custom fields: {color:'red', size:'L', stock:50}
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  search_vec  TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(name, '')           || ' ' ||
      coalesce(description, '')    || ' ' ||
      coalesce(category, '')       || ' ' ||
      coalesce(subcategory, '')    || ' ' ||
      coalesce(sku, '')            || ' ' ||
      coalesce(attributes::text, '')   -- attribute values searchable too
    )
  ) STORED,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_products_search
  ON client_products USING GIN (search_vec);

CREATE INDEX IF NOT EXISTS idx_client_products_attributes
  ON client_products USING GIN (attributes);

CREATE INDEX IF NOT EXISTS idx_client_products_client
  ON client_products (client_id, active);

CREATE INDEX IF NOT EXISTS idx_client_products_category
  ON client_products (client_id, category, active);

-- ─── 4. client_attribute_schemas ─────────────────────────────────────────────
-- Documents what custom attributes each client uses.
-- Used by: AI SQL schema injection, Admin UI form rendering, catalog page display
CREATE TABLE IF NOT EXISTS client_attribute_schemas (
  id          SERIAL PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  field_key   TEXT NOT NULL,                -- e.g. 'color', 'size', 'material'
  field_label TEXT NOT NULL,                -- e.g. 'Color', 'Size' (shown in UI)
  field_type  TEXT NOT NULL DEFAULT 'text', -- 'text' | 'number' | 'select' | 'boolean' | 'multiselect'
  options     JSONB,                        -- for select: ["Red","Blue","Green"]
  unit        TEXT,                         -- e.g. 'kg', 'cm', 'LKR'
  filterable  BOOLEAN NOT NULL DEFAULT TRUE,-- whether AI can filter by this field
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_attr_schema_client
  ON client_attribute_schemas (client_id, sort_order);

-- ─── 5. Seed: astrology_001 as first client ───────────────────────────────────
INSERT INTO clients (id, name, type)
VALUES ('astrology_001', 'පුරාණ ජෝතීර්වේදය', 'astrology')
ON CONFLICT (id) DO NOTHING;

INSERT INTO client_configs (
  client_id,
  phone_number_id,
  wa_token_env,
  ai_model,
  system_prompt_mode,
  brand_name,
  brand_color,
  order_id_prefix,
  product_catalog_enabled,
  order_flow_enabled,
  admin_password_env
) VALUES (
  'astrology_001',
  NULL,                       -- reads from PROD_PHONE_NUMBER_ID env var (handled in code)
  'PROD_META_ACCESS_TOKEN',   -- env var name
  'gemini-2.5-flash',
  'builtin',                  -- uses buildInstruction.js exactly as before
  'පුරාණ ජෝතීර්වේදය',
  '#075e54',
  'PJ',                       -- generates PJ2026-0001, PJ2026-0002 etc.
  FALSE,                      -- astrology has no product catalog
  TRUE,                       -- order flow enabled
  'ADMIN_PASSWORD'
) ON CONFLICT (client_id) DO UPDATE SET
  order_id_prefix         = COALESCE(client_configs.order_id_prefix, 'PJ'),
  product_catalog_enabled = COALESCE(client_configs.product_catalog_enabled, FALSE),
  order_flow_enabled      = COALESCE(client_configs.order_flow_enabled, TRUE);

-- ─── 6. Add client_id column to existing tables (nullable — no breakage) ──────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE customers ADD COLUMN client_id TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE messages ADD COLUMN client_id TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE orders ADD COLUMN client_id TEXT;
  END IF;
END $$;

-- ─── 6. Backfill all existing rows → astrology_001 ───────────────────────────
UPDATE customers SET client_id = 'astrology_001' WHERE client_id IS NULL;
UPDATE messages  SET client_id = 'astrology_001' WHERE client_id IS NULL;
UPDATE orders    SET client_id = 'astrology_001' WHERE client_id IS NULL;

-- ─── 7. Add FK constraints (idempotent) ──────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_customers_client' AND table_name = 'customers'
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT fk_customers_client
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_messages_client' AND table_name = 'messages'
  ) THEN
    ALTER TABLE messages
      ADD CONSTRAINT fk_messages_client
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_orders_client' AND table_name = 'orders'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT fk_orders_client
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ─── 9. Performance indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_customers_client ON customers (client_id);
CREATE INDEX IF NOT EXISTS idx_messages_client  ON messages  (client_id);
CREATE INDEX IF NOT EXISTS idx_orders_client    ON orders    (client_id);

COMMIT;

-- ─── Verify ───────────────────────────────────────────────────────────────────
-- Run these after migration to confirm:
--
--   SELECT * FROM clients;
--   SELECT * FROM client_configs;
--   SELECT * FROM client_attribute_schemas;
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'customers';
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'messages';
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'orders';
--   SELECT COUNT(*) FROM customers WHERE client_id IS NULL;  -- should be 0
--   SELECT COUNT(*) FROM messages  WHERE client_id IS NULL;  -- should be 0
--   SELECT COUNT(*) FROM orders    WHERE client_id IS NULL;  -- should be 0
