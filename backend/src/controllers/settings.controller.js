/**
 * @module controllers/settings.controller
 * @description Handlers for the client settings API
 * (get settings, update prompt/flags, change password).
 */

'use strict';

const bcrypt = require('bcryptjs');
const db     = require('../db');
const clientRouter  = require('../services/clientRouter');
const { invalidateClientKeys } = require('../services/clientKeys');
const pluginLoader  = require('../services/pluginLoader');
const { chatSessions } = require('../workers/sessionManager');
const resolveClientId  = require('../middleware/resolveClientId');
const { hasPermission } = require('../services/permissions');

/**
 * GET /api/settings — return the current client's settings row.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function getSettings(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const r = await db.pgQuery(
      `SELECT custom_prompt, error_message, system_prompt_mode, temperature, thinking_budget, brand_name, brand_color,
              order_fields, contact_number, knowledge_base_enabled, product_catalog_enabled, plugin_enabled,
              owner_phone, ai_enabled, away_message,
              (wa_token IS NOT NULL AND wa_token <> '') AS wa_token_set,
              (gemini_api_key IS NOT NULL AND gemini_api_key <> '') AS gemini_api_key_set,
              (freeastro_api_key IS NOT NULL AND freeastro_api_key <> '') AS freeastro_api_key_set,
              use_system_wa_token, use_system_gemini_key, use_system_freeastro_key
       FROM client_configs WHERE client_id=$1`,
      [clientId]
    );
    const row = r.rows[0] || {};
    if (row.order_fields && typeof row.order_fields === 'string') {
      try { row.order_fields = JSON.parse(row.order_fields); } catch { row.order_fields = []; }
    }
    if (!row.order_fields) row.order_fields = [];

    // Everyone signed in needs the structural half to draw a screen: the order
    // fields a Create Order form renders, the brand, the feature flags. The
    // prompt and which keys are set belong to whoever may edit them.
    if (!hasPermission(req.user, 'settings.prompts')) {
      const { custom_prompt, error_message, system_prompt_mode, temperature,
              thinking_budget, owner_phone, wa_token_set, gemini_api_key_set,
              freeastro_api_key_set, use_system_wa_token, use_system_gemini_key,
              use_system_freeastro_key, ...safe } = row;
      return res.json(safe);
    }
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * PUT /api/settings/prompt — update custom prompt, error message, order fields,
 * knowledge base/product catalog/plugin flags for a client.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function updatePrompt(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { prompt, error_message, order_fields, contact_number, knowledge_base_enabled, product_catalog_enabled, plugin_enabled, owner_phone, thinking_budget } = req.body;
  // Absent means 'leave as is'; empty string means 'back to the default'.
  // 0 is a real, meaningful value here, so it must survive the check.
  const tbTouched = thinking_budget !== undefined;
  const tbValue = (thinking_budget === null || thinking_budget === '')
    ? null
    : Math.min(32768, Math.max(0, parseInt(thinking_budget, 10) || 0));
  let parsedFields = [];
  if (Array.isArray(order_fields)) {
    parsedFields = order_fields
      .map(f => ({
        key: String(f.key || '').trim(),
        label: String(f.label || '').trim(),
        description: String(f.description || '').trim(),
        required: Boolean(f.required),
      }))
      .filter(f => f.key && f.label);
  }
  try {
    await db.pgQuery(
      `UPDATE client_configs SET custom_prompt=$1, error_message=$2, order_fields=$3, contact_number=$4, knowledge_base_enabled=$5, product_catalog_enabled=$6, system_prompt_mode='custom', updated_at=NOW(), plugin_enabled=COALESCE($8, plugin_enabled), owner_phone=$9, thinking_budget=CASE WHEN $10 THEN $11 ELSE thinking_budget END WHERE client_id=$7`,
      [prompt || null, error_message || null, JSON.stringify(parsedFields), contact_number || null,
        knowledge_base_enabled === true || knowledge_base_enabled === 'true',
        product_catalog_enabled === true || product_catalog_enabled === 'true',
        clientId,
        // superadmin: can enable or disable; client: can only disable (set false), not enable
        plugin_enabled === false || plugin_enabled === 'false' ? false
          : (req.user?.role === 'superadmin' && (plugin_enabled === true || plugin_enabled === 'true')) ? true
          : null, // null → COALESCE keeps existing DB value
        owner_phone || null,
        tbTouched,
        tbValue,
      ]
    );
    clientRouter.invalidateCache(clientId);
    invalidateClientKeys(clientId);
    pluginLoader.invalidatePlugin(clientId);
    for (const key of chatSessions.keys()) {
      if (key.startsWith(`${clientId}:`)) chatSessions.delete(key);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * PUT /api/settings/password — change CRM login password for the current client.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'currentPassword and newPassword required' });
  const clientId = req.user.clientId;
  if (!clientId) return res.status(403).json({ error: 'Superadmin password change not supported via API' });
  try {
    const r = await db.pgQuery(`SELECT crm_password_hash FROM client_configs WHERE client_id=$1`, [clientId]);
    if (!r.rows.length || !r.rows[0].crm_password_hash) return res.status(400).json({ error: 'No password set' });
    const valid = await bcrypt.compare(currentPassword, r.rows[0].crm_password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    await db.pgQuery(`UPDATE client_configs SET crm_password_hash=$1 WHERE client_id=$2`, [hash, clientId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * PUT /api/settings/tokens — update a client's own WA token, Gemini key or
 * freeastroapi key. Blank fields are ignored rather than clearing the stored value.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function updateTokens(req, res) {
  // resolveClientId pins a non-superadmin to their own client, so a client can
  // only ever write their own keys.
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  // use_system_*_key decides whose account the usage is billed to, so it stays a
  // superadmin decision on the Clients page and is deliberately not accepted here.
  if (req.body.use_system_gemini_key !== undefined || req.body.use_system_freeastro_key !== undefined) {
    return res.status(403).json({ error: 'Billing to the system key can only be changed by an administrator' });
  }

  const { wa_token, gemini_api_key, freeastro_api_key } = req.body;
  // Only non-empty values are written: the form never receives the stored key
  // back, so treating a blank field as "clear it" would let an untouched save
  // silently wipe a live key and take the client offline.
  const provided = { wa_token, gemini_api_key, freeastro_api_key };
  const writable = Object.entries(provided).filter(([, v]) => typeof v === 'string' && v.trim() !== '');
  if (!writable.length) {
    return res.status(400).json({ error: 'Provide at least one of wa_token, gemini_api_key, freeastro_api_key' });
  }
  try {
    const sets = [];
    const vals = [];
    for (const [col, v] of writable) sets.push(`${col}=$${vals.push(v.trim())}`);
    vals.push(clientId);
    await db.pgQuery(
      `UPDATE client_configs SET ${sets.join(', ')}, updated_at=NOW() WHERE client_id=$${vals.length}`,
      vals
    );
    clientRouter.invalidateCache(clientId);
    invalidateClientKeys(clientId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * PUT /api/settings/ai-mode - turn this client's bot on or off entirely.
 *
 * The webhook has always honoured client_configs.ai_enabled; nothing ever
 * exposed it, so the only way to silence the bot was per customer, one chat at
 * a time. This is the switch for "stop replying to anyone until I say so".
 *
 * Deliberately its own endpoint rather than a field on the settings form. If
 * turning the bot off means filling in a form and pressing Save, it will not be
 * reached for in the moment somebody needs it.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function setAiMode(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled (boolean) required' });
  try {
    // Writing the away message here too: it only matters while the bot is off,
     // so this is where somebody is thinking about it.
    const hasAway = typeof req.body?.away_message === 'string';
    const r = await db.pgQuery(
      `UPDATE client_configs
          SET ai_enabled=$2,
              away_message = CASE WHEN $3 THEN NULLIF($4, '') ELSE away_message END,
              updated_at=NOW()
        WHERE client_id=$1 RETURNING ai_enabled, away_message`,
      [clientId, enabled, hasAway, (req.body?.away_message || '').trim()]);
    if (!r.rows.length) return res.status(404).json({ error: 'No such client' });
    // The webhook reads the cached client, so without this the switch does
    // nothing until the cache happens to expire.
    clientRouter.invalidateCache(clientId);
    for (const key of chatSessions.keys()) {
      if (key.startsWith(`${clientId}:`)) chatSessions.delete(key);
    }
    console.log(`[SETTINGS] ${req.user.sub} turned ${clientId}'s bot ${enabled ? 'ON' : 'OFF'}`);
    res.json({ ok: true, ai_enabled: r.rows[0].ai_enabled, away_message: r.rows[0].away_message });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = { getSettings, updatePrompt, changePassword, updateTokens, setAiMode };
