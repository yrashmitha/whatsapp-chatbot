/**
 * @module controllers/public.controller
 * @description Public (API-key guarded) endpoints for external frontends such
 * as the web frontend. These are NOT behind JWT — they are the channel
 * through which a website visitor previews their chart and places an order that
 * lands in the same CRM as WhatsApp orders.
 */

'use strict';

const db = require('../db');
const clientRouter = require('../services/clientRouter');
const { generateOrderId } = require('../services/gemini');
const { calculateVedicChart } = require('../services/vedicChart');

const WEB_CLIENT_ID = process.env.WEB_CLIENT_ID || 'astrology_001';

/**
 * Validate and coerce the shared birth payload used by both endpoints.
 * Accepts numeric or string values; returns a normalized object or throws.
 */
function parseBirth(body) {
  const { year, month, day, hour, minute, lat, lng } = body;
  const nums = { year, month, day, hour, minute, lat, lng };
  for (const [k, v] of Object.entries(nums)) {
    if (v == null || v === '' || Number.isNaN(Number(v))) {
      throw new Error(`Missing or invalid birth field: ${k}`);
    }
  }
  return {
    year: Number(year), month: Number(month), day: Number(day),
    hour: Number(hour), minute: Number(minute),
    lat: Number(lat), lng: Number(lng),
    tz_str:       body.tz_str,
    ayanamsha:    body.ayanamsha,
    house_system: body.house_system,
    node_type:    body.node_type,
    vargas:       body.vargas,
    dasha_levels: body.dasha_levels,
  };
}

/**
 * POST /public/chart — return the vedic chart for a birth (cached).
 * Body: { year, month, day, hour, minute, lat, lng, [tz_str, ...] }
 * Response: { ok, cached, data } where `data` is the full freeastroapi response.
 */
async function publicChart(req, res) {
  let birth;
  try { birth = parseBirth(req.body); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  try {
    // Use the same freeastroapi key as the working horoscope flow: prefer the
    // plugin config key stored in the DB, fall back to the env var.
    let apiKey = process.env.FREEASTRO_API_KEY;
    try {
      const config = await db.getPluginConfig(WEB_CLIENT_ID, 'horoscope_reading');
      if (config && config.api_key) apiKey = config.api_key;
    } catch { /* no plugin config — fall back to env */ }

    const { data, cached } = await calculateVedicChart(birth, apiKey);
    res.json({ ok: true, cached, data });
  } catch (e) {
    const status = e.response?.status;
    const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    console.error('[PUBLIC-CHART]', status || '', detail);
    res.status(502).json({ error: 'Chart calculation failed' });
  }
}

/**
 * POST /public/orders — create a pending-payment order from the web FE.
 * Body: { phone_number, custom_fields: { customer_name, birth_date, birth_time,
 *         birth_place, lat, lng, ... }, notes? }
 * The order lands in the CRM under the web client, awaiting payment (the user
 * then sends their bank receipt via WhatsApp, exactly like the funnel says).
 */
async function publicCreateOrder(req, res) {
  const { phone_number, custom_fields, notes } = req.body;
  if (!phone_number) return res.status(400).json({ error: 'phone_number required' });
  if (!custom_fields || typeof custom_fields !== 'object') {
    return res.status(400).json({ error: 'custom_fields object required' });
  }

  try {
    const client = await clientRouter.getClientById(WEB_CLIENT_ID);
    if (!client) return res.status(500).json({ error: 'Web client not configured' });

    const orderId = await generateOrderId(client);
    const fields = { ...custom_fields, source: custom_fields.source || 'web' };

    // Ensure customer row exists (FK constraint on orders.phone_number)
    await db.pgQuery(
      `INSERT INTO customers (phone_number, client_id) VALUES ($1, $2) ON CONFLICT (phone_number) DO NOTHING`,
      [phone_number, WEB_CLIENT_ID]
    );
    if (fields.customer_name) {
      await db.pgQuery(`UPDATE customers SET name=$1 WHERE phone_number=$2`, [fields.customer_name, phone_number]);
    }

    await db.insertOrder(orderId, phone_number, WEB_CLIENT_ID, fields);
    await db.pgQuery(`UPDATE orders SET status=$1 WHERE order_id=$2`, ['pending-payment', orderId]);
    if (notes) {
      await db.pgQuery(`UPDATE orders SET notes=$1 WHERE order_id=$2`, [notes, orderId]);
    }

    res.json({ ok: true, order_id: orderId });
  } catch (e) {
    console.error('[PUBLIC-ORDER]', e.message);
    res.status(500).json({ error: e.message });
  }
}

module.exports = { publicChart, publicCreateOrder };
