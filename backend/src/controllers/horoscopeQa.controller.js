/**
 * @module controllers/horoscopeQa.controller
 * @description Handlers for the follow-up Q&A feature — finding a customer's
 * already-delivered report and drafting replies to questions about it.
 *
 * Unlike the wwjs original, the reports live in this database, so there is no
 * cache: a lookup is a local query, and caching would serve stale content
 * after a report is regenerated.
 */

'use strict';

const db = require('../db');
const { fetchLatestHoroscopeForPhone } = require('../services/deliveredHoroscope');
const { draftHoroscopeReply } = require('../services/horoscopeQa');
const resolveClientId = require('../middleware/resolveClientId');

/** Addon that gates this feature. */
const ADDON_ID = 'horoscope_followup_qa';

/**
 * Resolve the client and confirm the addon is enabled, answering the request
 * directly when it is not.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<string|null>} clientId, or null when already answered
 */
async function guard(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) { res.status(400).json({ error: 'client_id required' }); return null; }
  if (!await db.hasAddon(clientId, ADDON_ID)) {
    res.status(403).json({ error: `${ADDON_ID} addon not enabled` });
    return null;
  }
  return clientId;
}

/**
 * GET /api/horoscope-qa/:phone — the customer's most recent delivered report.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function getHoroscope(req, res) {
  const clientId = await guard(req, res);
  if (!clientId) return;

  try {
    const record = await fetchLatestHoroscopeForPhone(clientId, req.params.phone);
    if (!record) return res.json({ found: false });
    res.json({ found: true, data: record, fetched_at: record.fetchedAt });
  } catch (e) {
    console.error('[HOROSCOPE-QA] fetch error:', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

/**
 * POST /api/horoscope-qa/:phone/refresh — re-read the report.
 *
 * Kept for parity with the panel's "Re-fetch" control. Since the lookup is
 * always live, this differs from a plain GET only in intent.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function refreshHoroscope(req, res) {
  return getHoroscope(req, res);
}

/**
 * POST /api/horoscope-qa/:phone/ask — draft a reply to a follow-up question.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function askHoroscope(req, res) {
  const clientId = await guard(req, res);
  if (!clientId) return;

  const { question } = req.body || {};
  if (!question || !question.trim()) {
    return res.status(400).json({ error: 'question required' });
  }

  try {
    const record = await fetchLatestHoroscopeForPhone(clientId, req.params.phone);
    if (!record) return res.status(404).json({ error: 'No report found for this customer' });

    const reply = await draftHoroscopeReply(clientId, req.params.phone, record, question.trim());
    res.json({ reply });
  } catch (e) {
    console.error('[HOROSCOPE-QA] ask error:', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

module.exports = { getHoroscope, refreshHoroscope, askHoroscope };
