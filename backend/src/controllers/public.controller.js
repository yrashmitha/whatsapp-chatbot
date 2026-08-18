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
const { generateTeaserReading } = require('../services/teaserReading');
const { calculateMatch, matchHash, normalizePerson } = require('../services/matchmaking');
const { getFreeAstroKey } = require('../services/clientKeys');
const { generateDeepMatchAnalysis } = require('../services/deepMatchAnalysis');

// No default: an unset WEB_CLIENT_ID must fail loudly rather than route the
// public site's traffic and orders into whichever tenant happened to be first.
const WEB_CLIENT_ID = process.env.WEB_CLIENT_ID || null;
if (!WEB_CLIENT_ID) console.warn('[PUBLIC] WEB_CLIENT_ID is not set — public endpoints will return 503');

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
 * Response: { ok, cached, data, teaser } where `data` is the full freeastroapi
 * response and `teaser` is an array of up to 3 { topic, teaser } sections (or
 * null) — only the topics Gemini chose are ever generated/sent; the rest are
 * rendered client-side as static locked cards with no server-sent content.
 */
async function publicChart(req, res) {
  let birth;
  try { birth = parseBirth(req.body); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  try {
    // Use the same freeastroapi key as the working horoscope flow: prefer the
    // plugin config key stored in the DB, fall back to the env var.
    const apiKey = await getFreeAstroKey(WEB_CLIENT_ID);

    const { data, cached, hash } = await calculateVedicChart(birth, apiKey);

    // Best-effort teaser: one Gemini call per unique chart (cached by the same
    // birth_hash), never blocks or fails the chart response.
    let teaser = null;
    try { teaser = await generateTeaserReading(data, hash, WEB_CLIENT_ID); } catch { /* non-fatal */ }

    res.json({ ok: true, cached, data, teaser });
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
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

/**
 * POST /public/match — Ashtakoota (8-koota) compatibility for two people,
 * cached. Body: { person1: {year,month,day,hour,minute,lat,lng,...},
 *                 person2: {...same shape} }
 * Response: { ok, cached, data } where `data` is the full freeastroapi
 * /vedic/match response (ashtakoota kootas, manglik/nadi/bhakoot doshas,
 * summary). Shown alongside — not instead of — our primary 20-Porondam table.
 */
async function publicMatch(req, res) {
  const { person1, person2 } = req.body || {};
  if (!person1 || !person2) {
    return res.status(400).json({ error: 'person1 and person2 required' });
  }

  try {
    const apiKey = await getFreeAstroKey(WEB_CLIENT_ID);

    const { data, cached } = await calculateMatch(person1, person2, apiKey);
    res.json({ ok: true, cached, data });
  } catch (e) {
    const status = e.response?.status;
    const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    console.error('[PUBLIC-MATCH]', status || '', detail);
    res.status(502).json({ error: 'Match calculation failed' });
  }
}

/**
 * POST /public/deep-match — AI-assisted narrative layer over deterministic
 * compatibility facts computed client-side. Body: { person1, person2,
 * porondam_factors, facts, final_recommendation }. Every number/boolean in
 * `facts`/`final_recommendation` is computed by the frontend in code (house
 * positions, aspect rules, dasha-lord friendships) — Gemini only classifies
 * the 20 Porondam and writes explanations for the given facts, never invents
 * them. Cached by the same match_hash as /public/match.
 */
async function publicDeepMatch(req, res) {
  const { person1, person2, porondam_factors, facts, final_recommendation } = req.body || {};
  if (!person1 || !person2 || !Array.isArray(porondam_factors) || !facts || !final_recommendation) {
    return res.status(400).json({ error: 'person1, person2, porondam_factors, facts, and final_recommendation are required' });
  }

  try {
    const hash = matchHash(normalizePerson(person1), normalizePerson(person2));

    const analysis = await generateDeepMatchAnalysis(
      porondam_factors, facts, final_recommendation, hash, WEB_CLIENT_ID,
    );
    if (!analysis) return res.status(502).json({ error: 'Deep match analysis unavailable' });

    res.json({ ok: true, data: analysis });
  } catch (e) {
    console.error('[PUBLIC-DEEP-MATCH]', e.message);
    res.status(502).json({ error: 'Deep match analysis failed' });
  }
}

module.exports = { publicChart, publicCreateOrder, publicMatch, publicDeepMatch };
