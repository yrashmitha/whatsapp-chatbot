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
const { getBrand } = require('../services/branding');

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
  {
    id: 'media_extractor',
    name: 'Media Extraction',
    description: 'Uses Gemini Vision to read and summarise images, PDFs, audio, and documents sent by customers — extracts text, credentials, and key details so the AI can respond contextually.',
  },
  {
    id: 'follow_up_generator',
    name: 'Follow-up Generator',
    description: 'Generates a short, personalised follow-up message for a customer based on their conversation history, ready for a CRM agent to review and send.',
  },
  {
    id: 'meta_conversions',
    name: 'Meta Conversions',
    description: 'Sends Lead events to Meta CAPI when orders are placed, and Purchase events when payments are confirmed. Also syncs paid customer phones to a Meta Custom Audience for lookalike targeting.',
  },
  {
    id: 'match_making',
    name: 'Match Making Report',
    description: 'Generates a two-chart compatibility (ගැළපීම) report for a couple, including the 20 Porondam analysis. Requires Horoscope Reading.',
  },
  {
    id: 'income_summary',
    name: 'Income Summary',
    description: 'Shows a monthly revenue total on the Orders page, summed from confirmed payments.',
  },
];

/**
 * Addons that expose a prompt/config editor on the Plugins page.
 * The frontend renders its editor list from this rather than keeping its own copy.
 * @type {Set<string>}
 */
const CONFIGURABLE_ADDONS = new Set([
  'astro_vedic_chart', 'horoscope_reading', 'ai_call_answering', 'image_analyzer',
  'tarot_reading', 'media_extractor', 'follow_up_generator', 'meta_conversions',
]);

/**
 * GET /api/addons/catalog — the addon catalog, readable by any authenticated user.
 *
 * Separate from listAddons(), which is superadmin-only and also returns per-client
 * enabled state. This one carries no client data, just the catalog itself.
 *
 * @param {import('express').Request}  _req
 * @param {import('express').Response} res
 * @returns {void}
 */
function addonCatalog(_req, res) {
  res.json(ADDON_CATALOG.map(a => ({ ...a, configurable: CONFIGURABLE_ADDONS.has(a.id) })));
}

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
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
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
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
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
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
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
    const addonCheckOk = await db.hasAddon(clientId, 'crm_media_send');
    if (!addonCheckOk) return res.status(403).json({ error: 'crm_media_send addon not enabled' });

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
    const addonCheckOk = await db.hasAddon(clientId, 'tarot_reading');
    if (!addonCheckOk) {
      return res.status(403).json({ error: 'tarot_reading addon not enabled' });
    }

    // ── Chat context (no order_id): synchronous — return reading directly ──
    if (!order_id) {
      let customPrompt = null;
      try {
        const config = await db.getPluginConfig(clientId, 'tarot_reading');
        customPrompt = config?.prompt || null;
      } catch { /* no config */ }

      console.log(`[TAROT] Sync reading for ${phone} | client=${clientId}`);
      const { reading, cards } = await generateTarotReading(clientId, question, customPrompt);
      return res.json({ ok: true, reading, cards, question });
    }

    // ── Orders context (order_id present): background mode ──

    // Return cached if not regenerating and saved reading already exists
    if (!regenerate) {
      const existing = await db.pgQuery(`SELECT tarot_data FROM orders WHERE order_id=$1`, [order_id]);
      const td = existing.rows[0]?.tarot_data;
      if (td && td.reading && td.cards) {
        console.log(`[TAROT] Returning cached reading for order ${order_id}`);
        return res.json({ ok: true, reading: td.reading, cards: td.cards, question: td.question, fromCache: true });
      }
    }

    // Mark as generating so frontend can show progress
    await db.pgQuery(
      `UPDATE orders SET tarot_data=$1 WHERE order_id=$2`,
      [JSON.stringify({ generating: true, question }), order_id]
    ).catch(() => {});

    // Return immediately — generation runs in background
    res.json({ ok: true, generating: true });

    // Load optional custom prompt
    let customPrompt = null;
    try {
      const config = await db.getPluginConfig(clientId, 'tarot_reading');
      customPrompt = config?.prompt || null;
    } catch { /* no config */ }

    console.log(`[TAROT] Background generation for ${phone} | order=${order_id} | client=${clientId}`);
    generateTarotReading(clientId, question, customPrompt).then(async ({ reading, cards }) => {
      const tarotData = { question, reading, cards, generated_at: new Date().toISOString() };
      await db.pgQuery(
        `UPDATE orders SET tarot_data=$1 WHERE order_id=$2`,
        [JSON.stringify(tarotData), order_id]
      ).catch(e => console.warn('[TAROT] Failed to save tarot_data:', e.message));
      console.log(`[TAROT] Background generation complete for order ${order_id}`);
    }).catch(async (e) => {
      console.error('[TAROT] Background generation error:', e.message);
      await db.pgQuery(
        `UPDATE orders SET tarot_data=$1 WHERE order_id=$2`,
        [JSON.stringify({ error: e.message, question }), order_id]
      ).catch(() => {});
    });

  } catch (e) {
    console.error('[TAROT] triggerTarotReading error:', e.message);
    if (!res.headersSent) res.status(e.statusCode || 500).json({ error: e.message });
  }
}

/**
 * PATCH /api/crm/tarot-reading/sections/:orderId — update reading text and/or cards.
 */
async function updateTarotSections(req, res) {
  const { orderId } = req.params;
  const { reading, cards } = req.body;
  try {
    const existing = await db.pgQuery('SELECT tarot_data FROM orders WHERE order_id=$1', [orderId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Order not found' });
    const td = (typeof existing.rows[0].tarot_data === 'string')
      ? JSON.parse(existing.rows[0].tarot_data || '{}')
      : (existing.rows[0].tarot_data || {});
    if (reading !== undefined) td.reading = reading;
    if (cards   !== undefined) td.cards   = cards;
    await db.pgQuery('UPDATE orders SET tarot_data=$1 WHERE order_id=$2', [JSON.stringify(td), orderId]);
    res.json({ ok: true });
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}

/**
 * GET /api/crm/tarot-reading/download/:orderId — stream .docx for an order.
 */
async function downloadTarotDocx(req, res) {
  const { orderId } = req.params;
  const clientId = resolveClientId(req);
  try {
    const [r, pluginCfg] = await Promise.all([
      db.pgQuery('SELECT phone_number, tarot_data FROM orders WHERE order_id=$1', [orderId]),
      clientId ? db.getPluginConfig(clientId, 'tarot_reading').catch(() => ({})) : Promise.resolve({}),
    ]);
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found' });
    const td = (typeof r.rows[0].tarot_data === 'string')
      ? JSON.parse(r.rows[0].tarot_data || '{}')
      : (r.rows[0].tarot_data || {});
    if (!td.reading || !td.cards) return res.status(404).json({ error: 'No tarot reading saved' });

    const brand = await getBrand(clientId);
    const docxBuffer = await buildTarotDoc({
      question: td.question || '', reading: td.reading, cards: td.cards,
      page1_body: pluginCfg.page1_body || undefined,
      page2_body: pluginCfg.page2_body || undefined,
      page4_body: pluginCfg.page4_body || undefined,
      brand,
    });
    const last4 = (r.rows[0].phone_number || '').replace(/\D/g, '').slice(-4) || '0000';
    const filename = `tarot-reading-${last4}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(docxBuffer);
  } catch (e) {
    console.error('[TAROT DOCX] error:', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

/**
 * GET /api/crm/tarot-reading/download-pdf/:orderId — stream PDF for an order.
 */
async function downloadTarotPdfByOrder(req, res) {
  const { orderId } = req.params;
  const clientId = resolveClientId(req);
  const { exec } = require('child_process');
  const fs   = require('fs');
  const os   = require('os');
  const path = require('path');

  try {
    const [r, pluginCfg] = await Promise.all([
      db.pgQuery('SELECT phone_number, tarot_data FROM orders WHERE order_id=$1', [orderId]),
      clientId ? db.getPluginConfig(clientId, 'tarot_reading').catch(() => ({})) : Promise.resolve({}),
    ]);
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found' });
    const td = (typeof r.rows[0].tarot_data === 'string')
      ? JSON.parse(r.rows[0].tarot_data || '{}')
      : (r.rows[0].tarot_data || {});
    if (!td.reading || !td.cards) return res.status(404).json({ error: 'No tarot reading saved' });

    const uid     = `tarot-${Date.now()}`;
    const tmpHome = path.join(os.tmpdir(), `lo-home-${uid}`);
    const tmpDocx = path.join(os.tmpdir(), `${uid}.docx`);
    const tmpPdf  = path.join(os.tmpdir(), `${uid}.pdf`);

    // Copy bundled fonts into all locations LibreOffice checks (same as horoscope)
    const fontSrc  = path.join(__dirname, '../assets/fonts');
    const fontDirs = [
      path.join(tmpHome, '.fonts'),
      path.join(tmpHome, '.local', 'share', 'fonts'),
      path.join(tmpHome, '.config', 'libreoffice', '4', 'user', 'fonts'),
    ];
    for (const dir of fontDirs) {
      fs.mkdirSync(dir, { recursive: true });
      for (const f of fs.readdirSync(fontSrc)) {
        if (f.endsWith('.ttf')) fs.copyFileSync(path.join(fontSrc, f), path.join(dir, f));
      }
    }
    const fontDest = fontDirs[0];

    const brand = await getBrand(clientId);
    const docxBuffer = await buildTarotDoc({
      question: td.question || '', reading: td.reading, cards: td.cards,
      page1_body: pluginCfg.page1_body || undefined,
      page2_body: pluginCfg.page2_body || undefined,
      page4_body: pluginCfg.page4_body || undefined,
      brand,
    });
    fs.writeFileSync(tmpDocx, docxBuffer);

    await new Promise((resolve, reject) => {
      exec(
        `fc-cache -f "${fontDest}" 2>/dev/null; soffice --headless --convert-to pdf --outdir "${os.tmpdir()}" "${tmpDocx}"`,
        { env: { ...process.env, HOME: tmpHome } },
        (err, _stdout, stderr) => { if (err) reject(new Error(stderr || err.message)); else resolve(); }
      );
    });

    const { PDFDocument } = require('pdf-lib');
    const rawPdf = fs.readFileSync(tmpPdf);
    const pdfDoc = await PDFDocument.load(rawPdf);
    pdfDoc.setTitle(brand.pdf.title || '');
    pdfDoc.setAuthor(brand.pdf.author || '');
    pdfDoc.setCreator(brand.pdf.producer || ''); pdfDoc.setProducer(brand.pdf.producer || '');
    pdfDoc.setSubject(brand.pdf.subject || ''); pdfDoc.setKeywords([]);
    const buffer = Buffer.from(await pdfDoc.save());

    fs.rm(tmpHome, { recursive: true, force: true }, () => {});
    fs.unlink(tmpDocx, () => {}); fs.unlink(tmpPdf, () => {});

    const last4    = (r.rows[0].phone_number || '').replace(/\D/g, '').slice(-4) || '0000';
    const filename = `tarot-reading-${last4}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) {
    console.error('[TAROT PDF] error:', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
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
      return res.status(e.statusCode || 500).json({ error: e.message });
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
  const tmpHome = path.join(os.tmpdir(), `lo-home-${uid}`);
  const tmpDocx = path.join(os.tmpdir(), `${uid}.docx`);
  const tmpPdf  = path.join(os.tmpdir(), `${uid}.pdf`);

  // Copy bundled fonts into all locations LibreOffice checks (same as horoscope)
  const fontSrc2  = path.join(__dirname, '../assets/fonts');
  const fontDirs2 = [
    path.join(tmpHome, '.fonts'),
    path.join(tmpHome, '.local', 'share', 'fonts'),
    path.join(tmpHome, '.config', 'libreoffice', '4', 'user', 'fonts'),
  ];
  for (const dir of fontDirs2) {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(fontSrc2)) {
      if (f.endsWith('.ttf')) fs.copyFileSync(path.join(fontSrc2, f), path.join(dir, f));
    }
  }
  const fontDest2 = fontDirs2[0];

  try {
    const brand = await getBrand(resolveClientId(req));
    const docxBuffer = await buildTarotDoc({ question, reading, cards, brand });
    fs.writeFileSync(tmpDocx, docxBuffer);

    await new Promise((resolve, reject) => {
      exec(
        `fc-cache -f "${fontDest2}" 2>/dev/null; soffice --headless --convert-to pdf --outdir "${os.tmpdir()}" "${tmpDocx}"`,
        { env: { ...process.env, HOME: tmpHome } },
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
    pdfDoc.setTitle(brand.pdf.title || '');
    pdfDoc.setAuthor(brand.pdf.author || '');
    pdfDoc.setCreator(brand.pdf.producer || '');
    pdfDoc.setProducer(brand.pdf.producer || '');
    pdfDoc.setSubject(brand.pdf.subject || '');
    pdfDoc.setKeywords([]);
    const buffer = Buffer.from(await pdfDoc.save());

    fs.rm(tmpHome, { recursive: true, force: true }, () => {});
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
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

module.exports = {
  addonCatalog, ADDON_CATALOG, listAddons, toggleAddon, getAddonsStatus, sendMedia, triggerTarotReading, updateTarotSections, downloadTarotDocx, downloadTarotPdfByOrder, downloadTarotPdf };
