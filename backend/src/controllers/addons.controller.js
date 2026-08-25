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
 *
 * This copy is customer-facing: it is what a client reads on the Plugins page
 * and in the locked-feature dialog. It describes what the service delivers, in
 * the client's own terms, and deliberately names no vendors or internal
 * machinery — that is an implementation detail, not a selling point.
 *
 * @type {Array<{id: string, name: string, description: string}>}
 */
const ADDON_CATALOG = [
  {
    id: 'crm_media_send',
    name: 'Media Sending',
    description: 'Send images, PDFs and voice notes straight to a customer on WhatsApp from the chat screen, without leaving the CRM.',
  },
  {
    id: 'astro_vedic_chart',
    name: 'Personalised Chart Messages',
    description: 'Turn a customer\u2019s birth chart into a personal WhatsApp message written for them, so pending orders get a warm, relevant nudge instead of a reminder.',
  },
  {
    id: 'horoscope_reading',
    name: 'Full Horoscope Report',
    description: 'A complete written horoscope, section by section, delivered as a ready-to-send Word document and PDF in your own branding \u2014 prepared in minutes instead of days.',
  },
  {
    id: 'ai_call_answering',
    name: 'Call Answering',
    description: 'Answers your inbound phone calls when you cannot, holds the conversation, and files a full written transcript against the customer in the CRM.',
  },
  {
    id: 'image_analyzer',
    name: 'Payment Slip Checking',
    description: 'Reads bank slips and receipts the moment a customer sends them, pulls out the amount, date and reference, matches them to the right order, and flags anything that looks wrong.',
  },
  {
    id: 'tarot_reading',
    name: 'Tarot Reading',
    description: 'A personal three-card reading \u2014 past, present and future \u2014 written around the customer\u2019s own question and delivered as a finished document.',
  },
  {
    id: 'media_extractor',
    name: 'Attachment Reading',
    description: 'Reads whatever a customer sends \u2014 photos, PDFs, voice notes, documents \u2014 and pulls out the details, so nothing is missed and replies stay on point.',
  },
  {
    id: 'follow_up_generator',
    name: 'Follow-up Messages',
    description: 'Drafts a short, personal follow-up based on what the customer has already said, ready for your agent to read over and send.',
  },
  {
    id: 'meta_conversions',
    name: 'Meta Ads Tracking',
    description: 'Reports orders and confirmed payments back to Meta so your ad spend is measured against real sales, and builds an audience of paying customers to find more like them.',
  },
  {
    id: 'match_making',
    name: 'Compatibility Report',
    description: 'A full two-chart compatibility (\u0d9c\u0dd0\u0dc5\u0db4\u0dd3\u0db8) report for a couple, including the twenty Porondam. Requires the Full Horoscope Report.',
  },
  {
    id: 'horoscope_followup_qa',
    name: 'Follow-up Answers',
    description: 'When a customer asks something after their report is delivered, drafts a reply in your own words — written as a chat message, not a report extract — using what their reading already says.',
  },
  {
    id: 'income_summary',
    name: 'Monthly Income',
    description: 'See this month\u2019s takings at a glance on the Orders page, totalled from confirmed payments.',
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

    await db.insertMessage(phone, msgText, 'bot', null, clientId, mediaType, fileUrl, wamid, null, { sentBy: req.user?.uid ?? null });
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
      page1_heading: pluginCfg.page1_heading || '',
      page2_heading: pluginCfg.page2_heading || '',
      page4_heading: pluginCfg.page4_heading || '',
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
      page1_heading: pluginCfg.page1_heading || '',
      page2_heading: pluginCfg.page2_heading || '',
      page4_heading: pluginCfg.page4_heading || '',
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
