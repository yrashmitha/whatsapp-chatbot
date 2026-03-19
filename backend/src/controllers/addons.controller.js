/**
 * @module controllers/addons.controller
 * @description Handlers for the addon management API
 * (list addons, toggle addon, get addons status, CRM media send).
 */

'use strict';

const axios = require('axios');
const db    = require('../db');
const clientRouter = require('../services/clientRouter');
const { waToken, waPhoneId } = require('../services/whatsapp');
const { PUBLIC_URL } = require('../config/env');
const resolveClientId = require('../middleware/resolveClientId');

/**
 * Catalog of available addons with their metadata.
 * @type {Array<{id: string, name: string, description: string}>}
 */
const ADDON_CATALOG = [
  {
    id: 'crm_media_send',
    name: 'CRM Media Send',
    description: 'Allows CRM agents to send images, PDFs, and audio messages to WhatsApp customers directly from the chat interface.',
  },
  {
    id: 'astro_vedic_chart',
    name: 'Vedic Astro Chart',
    description: 'Generates personalized astrology-based WhatsApp messages for customers using their vedic birth chart, to help recover pending orders.',
  },
  {
    id: 'horoscope_reading',
    name: 'Horoscope Reading',
    description: 'Generates full 10-section Vedic horoscope Word documents for payment_received orders.',
  },
  {
    id: 'ai_call_answering',
    name: 'AI Call Answering',
    description: 'Answers inbound Twilio phone calls with an AI agent, transcribes the conversation, and logs it in the CRM.',
  },
  {
    id: 'image_analyzer',
    name: 'Image Analyzer',
    description: 'Analyzes customer payment slips and documents (images and PDFs) using Gemini Vision — extracts amount, date, and reference, and flags suspicious slips.',
  },
];

/**
 * GET /api/addons?client_id=X — list addons with enabled state for a client (superadmin only).
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function listAddons(req, res) {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const clientId = req.query.client_id;
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const r = await db.pgQuery(`SELECT addon_id, enabled FROM client_addons WHERE client_id=$1`, [clientId]);
    const enabledMap = Object.fromEntries(r.rows.map(row => [row.addon_id, row.enabled]));
    const addons = ADDON_CATALOG.map(a => ({ ...a, enabled: enabledMap[a.id] ?? false }));
    res.json({ addons });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * PUT /api/addons/:addonId — toggle addon enabled state for a client (superadmin only).
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function toggleAddon(req, res) {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const { addonId } = req.params;
  const { client_id: clientId, enabled } = req.body;
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  if (!ADDON_CATALOG.find(a => a.id === addonId)) return res.status(404).json({ error: 'Unknown addon' });
  try {
    await db.pgQuery(
      `INSERT INTO client_addons (client_id, addon_id, enabled) VALUES ($1,$2,$3)
       ON CONFLICT (client_id, addon_id) DO UPDATE SET enabled=$3`,
      [clientId, addonId, !!enabled]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * GET /api/crm/addons-status — return enabled addon IDs for the current client (used by frontend).
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function getAddonsStatus(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.json({ addons: [] });
  try {
    const r = await db.pgQuery(
      `SELECT addon_id FROM client_addons WHERE client_id=$1 AND enabled=TRUE`,
      [clientId]
    );
    res.json({ addons: r.rows.map(row => row.addon_id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * POST /api/crm/send-media — CRM agent sends image/pdf/audio to a WhatsApp customer.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function sendMedia(req, res) {
  const clientId = resolveClientId(req);
  const { phone, caption = '' } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  if (!req.file) return res.status(400).json({ error: 'file required' });
  try {
    // Verify addon is enabled for this client
    const addonCheck = await db.pgQuery(
      `SELECT enabled FROM client_addons WHERE client_id=$1 AND addon_id='crm_media_send' AND enabled=TRUE`,
      [clientId]
    );
    if (!addonCheck.rows.length) return res.status(403).json({ error: 'crm_media_send addon not enabled' });

    const client = clientId ? await clientRouter.getClientById(clientId) : null;
    const base = PUBLIC_URL || '';
    const fileUrl = `${base}/uploads/${req.file.filename}`;
    const mime = req.file.mimetype;
    const origName = req.file.originalname;

    let waPayload;
    let mediaType;
    let msgText;

    if (/^image\//.test(mime)) {
      waPayload = { type: 'image', image: { link: fileUrl, ...(caption && { caption }) } };
      mediaType = 'image';
      msgText = caption || `[Image: ${origName}]`;
    } else if (mime === 'application/pdf') {
      waPayload = { type: 'document', document: { link: fileUrl, filename: origName, ...(caption && { caption }) } };
      mediaType = 'pdf';
      msgText = `[PDF: ${origName}]`;
    } else {
      waPayload = { type: 'audio', audio: { link: fileUrl } };
      mediaType = 'audio';
      msgText = `[Audio: ${origName}]`;
    }

    const mediaResp = await axios.post(
      `https://graph.facebook.com/v18.0/${waPhoneId(client)}/messages`,
      { messaging_product: 'whatsapp', to: phone, ...waPayload },
      { headers: { Authorization: `Bearer ${waToken(client)}`, 'Content-Type': 'application/json' } }
    );
    const wamid = mediaResp.data?.messages?.[0]?.id || null;

    await db.insertMessage(phone, msgText, 'bot', null, clientId, mediaType, fileUrl, wamid);
    res.json({ ok: true, url: fileUrl });
  } catch (e) {
    console.error('[CRM MEDIA] send-media error:', e.message);
    res.status(500).json({ error: e?.response?.data?.error?.message || e.message });
  }
}

module.exports = { ADDON_CATALOG, listAddons, toggleAddon, getAddonsStatus, sendMedia };
