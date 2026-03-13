'use strict';
// ─── clientRouter.js ─────────────────────────────────────────────────────────
// Resolves incoming WhatsApp webhook phone_number_id → client object
// Caches results for 5 minutes to avoid repeated DB hits
// ─────────────────────────────────────────────────────────────────────────────

const { pgQuery } = require('./db');

// In-memory cache: key → { client, expiresAt }
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const CLIENT_SELECT = `
  SELECT
    c.id, c.name, c.type, c.active,
    cc.phone_number_id, cc.wa_token_env, cc.webhook_verify_token,
    cc.ai_model, cc.system_prompt_mode, cc.custom_prompt, cc.temperature,
    cc.brand_name, cc.brand_color, cc.logo_url,
    cc.order_id_prefix, cc.product_catalog_enabled, cc.max_products_in_context,
    cc.catalog_search_mode, cc.order_flow_enabled, cc.admin_password_env
  FROM clients c
  JOIN client_configs cc ON cc.client_id = c.id
`;

/**
 * Resolves incoming webhook phone_number_id → client.
 * Returns null if no matching active client (webhook should be ignored).
 *
 * Client shape: { id, name, type, active, phone_number_id, wa_token_env,
 *   waToken, ai_model, system_prompt_mode, custom_prompt, temperature,
 *   brand_name, brand_color, logo_url, order_id_prefix,
 *   product_catalog_enabled, max_products_in_context, catalog_search_mode,
 *   order_flow_enabled, admin_password_env }
 */
async function getClientByPhoneNumberId(phoneNumberId) {
  if (!phoneNumberId) return null;

  const cached = cache.get(phoneNumberId);
  if (cached && cached.expiresAt > Date.now()) return cached.client;

  const res = await pgQuery(
    CLIENT_SELECT + `WHERE cc.phone_number_id = $1 AND c.active = TRUE LIMIT 1`,
    [phoneNumberId]
  );

  if (res.rows.length === 0) {
    console.warn(`[clientRouter] No active client for phone_number_id: ${phoneNumberId}`);
    return null;
  }

  const client = buildClient(res.rows[0]);
  cache.set(phoneNumberId, { client, expiresAt: Date.now() + CACHE_TTL_MS });
  return client;
}

/**
 * Returns client by client_id (for admin panel, catalog API, etc.)
 */
async function getClientById(clientId) {
  if (!clientId) return null;

  const cacheKey = `id:${clientId}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.client;

  const res = await pgQuery(
    CLIENT_SELECT + `WHERE c.id = $1 LIMIT 1`,
    [clientId]
  );

  if (res.rows.length === 0) return null;

  const client = buildClient(res.rows[0]);
  cache.set(cacheKey, { client, expiresAt: Date.now() + CACHE_TTL_MS });
  return client;
}

/**
 * Returns all clients (for admin superadmin view)
 */
async function getAllClients() {
  const res = await pgQuery(`
    SELECT c.id, c.name, c.type, c.active,
      cc.phone_number_id, cc.brand_name, cc.brand_color, cc.logo_url,
      cc.order_id_prefix, cc.product_catalog_enabled, cc.ai_model,
      cc.system_prompt_mode, cc.order_flow_enabled
    FROM clients c
    LEFT JOIN client_configs cc ON cc.client_id = c.id
    ORDER BY c.name
  `);
  return res.rows;
}

/** Invalidate cache for a given phoneNumberId or clientId */
function invalidateCache(key) {
  cache.delete(key);
  cache.delete(`id:${key}`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildClient(row) {
  const waToken = row.wa_token_env
    ? (process.env[row.wa_token_env] || '')
    : (process.env.PROD_META_ACCESS_TOKEN || '');
  return {
    ...row,
    waToken,
    active: !!row.active,
    product_catalog_enabled: !!row.product_catalog_enabled,
    order_flow_enabled: row.order_flow_enabled !== false,
  };
}

/** Fallback client for SQLite / local dev */
function buildLocalClient() {
  return {
    id: 'astrology_001',
    name: 'පුරාණ ජෝතීර්වේදය',
    type: 'astrology',
    active: true,
    phone_number_id: process.env.PROD_PHONE_NUMBER_ID || null,
    wa_token_env: 'PROD_META_ACCESS_TOKEN',
    waToken: process.env.PROD_META_ACCESS_TOKEN || '',
    ai_model: 'gemini-2.5-flash',
    system_prompt_mode: 'builtin',
    custom_prompt: null,
    temperature: 0.70,
    brand_name: 'පුරාණ ජෝතීර්වේදය',
    brand_color: '#075e54',
    logo_url: null,
    order_id_prefix: 'PJ',
    product_catalog_enabled: false,
    max_products_in_context: 10,
    catalog_search_mode: 'fts',
    order_flow_enabled: true,
    admin_password_env: 'ADMIN_PASSWORD',
  };
}

module.exports = { getClientByPhoneNumberId, getClientById, getAllClients, invalidateCache, buildLocalClient };
