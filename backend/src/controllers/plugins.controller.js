/**
 * @module controllers/plugins.controller
 * @description Handlers for the plugin configuration API
 * (get/set config, get customer data, generate astro chart message).
 */

'use strict';

const db   = require('../db');
const { generateAstroMessage, DEFAULT_ASTRO_PROMPT } = require('../services/astro');
const resolveClientId = require('../middleware/resolveClientId');

/**
 * GET /api/plugins/:pluginId/config — get plugin config for the current client.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function getPluginConfig(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { pluginId } = req.params;
  try {
    const config = await db.getPluginConfig(clientId, pluginId);
    const defaults = pluginId === 'astro_vedic_chart'
      ? { name: 'Vedic Astro Chart', prompt: DEFAULT_ASTRO_PROMPT }
      : { name: pluginId, prompt: '' };
    res.json({ ...defaults, ...config });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * PUT /api/plugins/:pluginId/config — update plugin config (superadmin or own client).
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function updatePluginConfig(req, res) {
  const clientId = req.body.client_id || resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  if (req.user.role !== 'superadmin' && req.user.clientId !== clientId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { pluginId } = req.params;
  const { name, prompt, api_key } = req.body;
  try {
    const existing = await db.getPluginConfig(clientId, pluginId);
    const update = { ...existing };
    if (name !== undefined) update.name = name;
    if (prompt !== undefined) update.prompt = prompt;
    if (api_key !== undefined) update.api_key = api_key;
    await db.upsertPluginConfig(clientId, pluginId, update);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * GET /api/plugins/:pluginId/customer-data/:phone — get saved customer data for a plugin.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function getPluginCustomerData(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { pluginId, phone } = req.params;
  try {
    const data = await db.getPluginCustomerData(clientId, phone, pluginId);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * POST /api/plugins/astro-chart — generate an astro chart message for a customer.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function generateAstroChart(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  // Check addon enabled
  const addonCheck = await db.pgQuery(
    `SELECT enabled FROM client_addons WHERE client_id=$1 AND addon_id='astro_vedic_chart' AND enabled=TRUE`,
    [clientId]
  );
  if (!addonCheck.rows.length) return res.status(403).json({ error: 'astro_vedic_chart addon not enabled' });

  const { phone, birth_date, birth_time, lat, lng, birth_place_name } = req.body;
  if (!phone || !birth_date || !birth_time || lat == null || lng == null) {
    return res.status(400).json({ error: 'phone, birth_date, birth_time, lat, lng required' });
  }

  // Parse birth date/time
  const [year, month, day] = birth_date.split('-').map(s => parseInt(s, 10));
  const [hour, minute] = birth_time.split(':').map(s => parseInt(s, 10));

  // Validate parsed values
  if (
    isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hour) || isNaN(minute) ||
    year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31 ||
    hour < 0 || hour > 23 || minute < 0 || minute > 59
  ) {
    return res.status(400).json({ error: `Invalid birth date or time. Received date="${birth_date}", time="${birth_time}". Use YYYY-MM-DD and HH:MM format.` });
  }

  try {
    const config = await db.getPluginConfig(clientId, 'astro_vedic_chart');
    const apiKey = config.api_key || process.env.FREEASTRO_API_KEY;

    const text = await generateAstroMessage(clientId, phone, { year, month, day, hour, minute, lat, lng, birth_place_name }, apiKey);
    res.json({ text });
  } catch (e) {
    console.error('[ASTRO] error:', e?.response?.data || e.message);
    const detail = e?.response?.data?.detail;
    const errMsg = Array.isArray(detail)
      ? detail.map(d => `${d.loc?.slice(-1)?.[0] || 'field'}: ${d.msg}`).join('; ')
      : (typeof detail === 'string' ? detail : e.message);
    res.status(500).json({ error: errMsg });
  }
}

module.exports = { getPluginConfig, updatePluginConfig, getPluginCustomerData, generateAstroChart };
