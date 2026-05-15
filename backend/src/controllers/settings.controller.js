/**
 * @module controllers/settings.controller
 * @description Handlers for the client settings API
 * (get settings, update prompt/flags, change password).
 */

'use strict';

const bcrypt = require('bcryptjs');
const db     = require('../db');
const clientRouter  = require('../services/clientRouter');
const pluginLoader  = require('../services/pluginLoader');
const { chatSessions } = require('../workers/sessionManager');
const resolveClientId  = require('../middleware/resolveClientId');

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
      `SELECT custom_prompt, error_message, system_prompt_mode, temperature, brand_name, brand_color,
              order_fields, contact_number, knowledge_base_enabled, product_catalog_enabled, plugin_enabled,
              owner_phone,
              (wa_token IS NOT NULL AND wa_token <> '') AS wa_token_set,
              (gemini_api_key IS NOT NULL AND gemini_api_key <> '') AS gemini_api_key_set,
              use_system_wa_token, use_system_gemini_key
       FROM client_configs WHERE client_id=$1`,
      [clientId]
    );
    const row = r.rows[0] || {};
    if (row.order_fields && typeof row.order_fields === 'string') {
      try { row.order_fields = JSON.parse(row.order_fields); } catch { row.order_fields = []; }
    }
    if (!row.order_fields) row.order_fields = [];
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
  const { prompt, error_message, order_fields, contact_number, knowledge_base_enabled, product_catalog_enabled, plugin_enabled, owner_phone } = req.body;
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
      `UPDATE client_configs SET custom_prompt=$1, error_message=$2, order_fields=$3, contact_number=$4, knowledge_base_enabled=$5, product_catalog_enabled=$6, system_prompt_mode='custom', updated_at=NOW(), plugin_enabled=COALESCE($8, plugin_enabled), owner_phone=$9 WHERE client_id=$7`,
      [prompt || null, error_message || null, JSON.stringify(parsedFields), contact_number || null,
        knowledge_base_enabled === true || knowledge_base_enabled === 'true',
        product_catalog_enabled === true || product_catalog_enabled === 'true',
        clientId,
        // superadmin: can enable or disable; client: can only disable (set false), not enable
        plugin_enabled === false || plugin_enabled === 'false' ? false
          : (req.user?.role === 'superadmin' && (plugin_enabled === true || plugin_enabled === 'true')) ? true
          : null, // null → COALESCE keeps existing DB value
        owner_phone || null,
      ]
    );
    clientRouter.invalidateCache(clientId);
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
 * PUT /api/settings/tokens — update WA token and/or Gemini API key for a client.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function updateTokens(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { wa_token, gemini_api_key } = req.body;
  if (wa_token === undefined && gemini_api_key === undefined) {
    return res.status(400).json({ error: 'wa_token or gemini_api_key required' });
  }
  try {
    const sets = [];
    const vals = [];
    if (wa_token !== undefined) { sets.push(`wa_token=$${vals.push(wa_token || null)}`); }
    if (gemini_api_key !== undefined) { sets.push(`gemini_api_key=$${vals.push(gemini_api_key || null)}`); }
    vals.push(clientId);
    await db.pgQuery(
      `UPDATE client_configs SET ${sets.join(', ')}, updated_at=NOW() WHERE client_id=$${vals.length}`,
      vals
    );
    clientRouter.invalidateCache(clientId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = { getSettings, updatePrompt, changePassword, updateTokens };
