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
const { generateTarotReading, buildTarotDoc } = require('../services/tarot');

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
  {
    id: 'tarot_reading',
    name: 'Tarot Reading',
    description: 'Generates a personalised 3-card tarot reading (Past / Present / Future) for a customer based on their question, interpreted by Gemini.',
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

/**
 * POST /api/crm/tarot-reading — Admin triggers a tarot reading for a customer.
 * Returns the reading text and card draw details; does NOT auto-send to WhatsApp.
 * The admin reviews the reading in the CRM and sends it manually.
 *
 * Body: { phone, question }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function triggerTarotReading(req, res) {
  const clientId = resolveClientId(req);
  const { phone, question, order_id, regenerate } = req.body;

  if (!phone)    return res.status(400).json({ error: 'phone required' });
  if (!question) return res.status(400).json({ error: 'question required' });

  try {
    const addonCheck = await db.pgQuery(
      `SELECT enabled FROM client_addons WHERE client_id=$1 AND addon_id='tarot_reading' AND enabled=TRUE`,
      [clientId]
    );
    if (!addonCheck.rows.length) {
      return res.status(403).json({ error: 'tarot_reading addon not enabled' });
    }

    // If order_id given and not regenerating, return saved reading if it exists
    if (order_id && !regenerate) {
      const existing = await db.pgQuery(
        `SELECT tarot_data FROM orders WHERE order_id=$1`, [order_id]
      );
      const td = existing.rows[0]?.tarot_data;
      if (td && td.reading && td.cards) {
        console.log(`[TAROT] Returning saved reading for order ${order_id}`);
        return res.json({ ok: true, reading: td.reading, cards: td.cards, question: td.question, fromCache: true });
      }
    }

    // Load optional custom prompt
    let customPrompt = null;
    try {
      const config = await db.getPluginConfig(clientId, 'tarot_reading');
      customPrompt = config?.prompt || null;
    } catch { /* no config — use default */ }

    console.log(`[TAROT] Generating reading for ${phone} | order=${order_id || 'none'} | client=${clientId}`);
    const { reading, cards } = await generateTarotReading(clientId, question, customPrompt);

    // Save to orders.tarot_data if order_id was provided
    if (order_id) {
      const tarotData = { question, reading, cards, generated_at: new Date().toISOString() };
      await db.pgQuery(
        `UPDATE orders SET tarot_data=$1 WHERE order_id=$2`,
        [JSON.stringify(tarotData), order_id]
      ).catch(e => console.warn('[TAROT] Failed to save tarot_data:', e.message));
    }

    res.json({ ok: true, reading, cards, question });
  } catch (e) {
    console.error('[TAROT] triggerTarotReading error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /api/crm/tarot-reading/pdf — Build and stream a PDF for a tarot reading.
 * Accepts the reading data in the request body (no DB storage needed).
 *
 * Body: { phone, question, reading, cards }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function downloadTarotPdf(req, res) {
  let { phone, order_id, question, reading, cards } = req.body;

  // If order_id provided, load from DB (allows PDF re-generation without re-passing all data)
  if (order_id && (!reading || !cards)) {
    try {
      const r = await db.pgQuery(
        `SELECT phone_number, tarot_data FROM orders WHERE order_id=$1`, [order_id]
      );
      if (!r.rows.length) return res.status(404).json({ error: 'Order not found' });
      const td = r.rows[0].tarot_data;
      if (!td || !td.reading) return res.status(404).json({ error: 'No tarot reading saved for this order' });
      phone    = phone    || r.rows[0].phone_number;
      question = question || td.question;
      reading  = td.reading;
      cards    = td.cards;
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (!question || !reading || !cards) {
    return res.status(400).json({ error: 'question, reading, and cards are required (or provide order_id)' });
  }

  const { exec } = require('child_process');
  const fs   = require('fs');
  const os   = require('os');
  const path = require('path');

  const uid     = `tarot-${Date.now()}`;
  const tmpDocx = path.join(os.tmpdir(), `${uid}.docx`);
  const tmpPdf  = path.join(os.tmpdir(), `${uid}.pdf`);

  try {
    const docxBuffer = await buildTarotDoc({ question, reading, cards });
    fs.writeFileSync(tmpDocx, docxBuffer);

    await new Promise((resolve, reject) => {
      exec(
        `soffice --headless --convert-to pdf --outdir "${os.tmpdir()}" "${tmpDocx}"`,
        (err, _stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve();
        }
      );
    });

    // Strip PDF metadata
    const { PDFDocument } = require('pdf-lib');
    const rawPdf = fs.readFileSync(tmpPdf);
    const pdfDoc = await PDFDocument.load(rawPdf);
    pdfDoc.setTitle('Tarot Card Reading');
    pdfDoc.setAuthor('Tarot Reading Service');
    pdfDoc.setCreator('');
    pdfDoc.setProducer('');
    pdfDoc.setSubject('Tarot Reading');
    pdfDoc.setKeywords([]);
    const buffer = Buffer.from(await pdfDoc.save());

    fs.unlink(tmpDocx, () => {});
    fs.unlink(tmpPdf, () => {});

    const last4    = (phone || '').replace(/\D/g, '').slice(-4) || '0000';
    const filename = `tarot-reading-${last4}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) {
    fs.unlink(tmpDocx, () => {});
    fs.unlink(tmpPdf, () => {});
    console.error('[TAROT PDF] error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

module.exports = { ADDON_CATALOG, listAddons, toggleAddon, getAddonsStatus, sendMedia, triggerTarotReading, downloadTarotPdf };
