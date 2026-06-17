/**
 * @module services/clientRouter
 * @description Resolves incoming WhatsApp webhook phone_number_id to a client object.
 * Caches results for 5 minutes to avoid repeated DB hits.
 * Moved from backend/clientRouter.js — db require path updated.
 */

'use strict';

const { pgQuery } = require('../db');

// In-memory cache: key → { client, expiresAt }
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const CLIENT_SELECT = `
  SELECT
    c.id, c.name, c.type, c.active, c.created_at,
    cc.phone_number_id, cc.wa_token_env, cc.wa_token, cc.use_system_wa_token, cc.webhook_verify_token,
    cc.ai_model, cc.system_prompt_mode, cc.custom_prompt, cc.error_message, cc.temperature,
    cc.brand_name, cc.brand_color, cc.logo_url,
    cc.order_id_prefix, cc.product_catalog_enabled, cc.knowledge_base_enabled, cc.max_products_in_context,
    cc.catalog_search_mode, cc.order_flow_enabled, cc.admin_password_env, cc.order_fields, cc.contact_number,
    cc.plugin_enabled, cc.ai_enabled, cc.gemini_api_key, cc.use_system_gemini_key,
    cc.owner_phone, cc.thinking_budget, cc.typing_delay_ms,
    cc.package_id, cc.bonus_messages, cc.overage_limit, cc.per_message_cost AS client_per_message_cost,
    p.message_limit AS package_message_limit, p.name AS package_name, p.per_message_cost AS package_per_message_cost
  FROM clients c
  JOIN client_configs cc ON cc.client_id = c.id
  LEFT JOIN packages p ON p.id = cc.package_id
`;

/**
 * Resolve an incoming webhook phone_number_id to an active client object.
 * Returns null if no matching active client is found.
 *
 * @param {string|null} phoneNumberId - WhatsApp Phone Number ID from the webhook payload
 * @returns {Promise<Object|null>} Client object or null
 */
async function getClientByPhoneNumberId(phoneNumberId) {
  if (!phoneNumberId) return null;

  // const cached = cache.get(phoneNumberId);
  // if (cached && cached.expiresAt > Date.now()) return cached.client;

  const res = await pgQuery(
    CLIENT_SELECT + `WHERE cc.phone_number_id = $1 AND c.active = TRUE LIMIT 1`,
    [phoneNumberId]
  );

  if (res.rows.length === 0) {
    console.warn(`[clientRouter] No active client for phone_number_id: ${phoneNumberId}`);
    return null;
  }

  const client = buildClient(res.rows[0]);
  // cache.set(phoneNumberId, { client, expiresAt: Date.now() + CACHE_TTL_MS });
  return client;
}

/**
 * Return client by client_id (for admin panel, catalog API, etc.)
 *
 * @param {string|null} clientId - Client ID string
 * @returns {Promise<Object|null>} Client object or null
 */
async function getClientById(clientId) {
  if (!clientId) return null;

  const cacheKey = `id:${clientId}`;
  // const cached = cache.get(cacheKey);
  // if (cached && cached.expiresAt > Date.now()) return cached.client;

  const res = await pgQuery(
    CLIENT_SELECT + `WHERE c.id = $1 LIMIT 1`,
    [clientId]
  );

  if (res.rows.length === 0) return null;

  const client = buildClient(res.rows[0]);
  // cache.set(cacheKey, { client, expiresAt: Date.now() + CACHE_TTL_MS });
  return client;
}

/**
 * Return all clients (for admin superadmin view).
 *
 * @returns {Promise<Array>} Array of client rows
 */
async function getAllClients() {
  const res = await pgQuery(`
    SELECT c.id, c.name, c.type, c.active, c.created_at,
      cc.phone_number_id, cc.brand_name, cc.brand_color, cc.logo_url,
      cc.order_id_prefix, cc.product_catalog_enabled, cc.ai_model,
      cc.system_prompt_mode, cc.order_flow_enabled, cc.ai_enabled,
      cc.use_system_wa_token, cc.use_system_gemini_key,
      cc.wa_token_env, cc.webhook_verify_token,
      cc.temperature, cc.custom_prompt, cc.error_message,
      cc.knowledge_base_enabled, cc.plugin_enabled, cc.contact_number,
      cc.order_fields, cc.admin_password_env,
      cc.package_id, cc.bonus_messages, cc.overage_limit, cc.per_message_cost,
      p.name AS package_name, p.message_limit AS package_message_limit
    FROM clients c
    LEFT JOIN client_configs cc ON cc.client_id = c.id
    LEFT JOIN packages p ON p.id = cc.package_id
    ORDER BY c.name
  `);
  return res.rows;
}

/**
 * Invalidate cache for a given phoneNumberId or clientId key.
 *
 * @param {string} key - Phone number ID or client ID
 * @returns {void}
 */
function invalidateCache(key) {
  cache.delete(key);
  cache.delete(`id:${key}`);
  // Also clear phone_number_id keyed entries for this client
  for (const [cacheKey, entry] of cache.entries()) {
    if (entry.client?.id === key) cache.delete(cacheKey);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Construct a normalised client object from a raw DB row.
 *
 * @param {Object} row - Raw DB row from CLIENT_SELECT query
 * @returns {Object} Normalised client object
 */
function buildClient(row) {
  // WhatsApp token: system checkbox → provider's env var; otherwise DB token → legacy env var name → null
  const waToken = row.use_system_wa_token
    ? (process.env.PROD_META_ACCESS_TOKEN || '')
    : row.wa_token
      || (row.wa_token_env ? (process.env[row.wa_token_env] || '') : '')
      || '';

  // Gemini key: system checkbox → null (gemini.js uses GEMINI_API_KEY); otherwise DB key → null
  const gemini_api_key = row.use_system_gemini_key
    ? null
    : (row.gemini_api_key || null);
  let orderFields = [];
  try {
    const raw = row.order_fields;
    if (raw) orderFields = typeof raw === 'string' ? JSON.parse(raw) : (raw || []);
  } catch (_) { orderFields = []; }
  return {
    ...row,
    waToken,
    gemini_api_key,
    use_system_gemini_key: !!row.use_system_gemini_key,
    active: !!row.active,
    ai_enabled: row.ai_enabled !== false,
    product_catalog_enabled: !!row.product_catalog_enabled,
    knowledge_base_enabled: !!row.knowledge_base_enabled,
    plugin_enabled: !!row.plugin_enabled,
    order_flow_enabled: row.order_flow_enabled !== false,
    order_fields: orderFields,
    contact_number: row.contact_number || null,
    owner_phone: row.owner_phone || null,
  };
}

/**
 * Build a fallback local client for SQLite / local dev when no DB client matches.
 *
 * @returns {Object} Hardcoded local client object
 */
function buildLocalClient() {
  console.warn('[clientRouter] WARNING: falling back to buildLocalClient — no DB client matched phone_number_id');
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
    order_fields: [],
    contact_number: null,
  };
}

module.exports = { getClientByPhoneNumberId, getClientById, getAllClients, invalidateCache, buildLocalClient };
