/**
 * @module controllers/addons.controller
 * @description Handlers for the addon management API
 * (list addons, toggle addon, get addons status, CRM media send).
 */

'use strict';

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
const db    = require('../db');
const clientRouter = require('../services/clientRouter');
const { waToken, waPhoneId } = require('../services/whatsapp');
const { PUBLIC_URL, UPLOADS_DIR } = require('../config/env');
const resolveClientId = require('../middleware/resolveClientId');
const { generateTarotReading, buildTarotDoc } = require('../services/tarot');
const { getBrand } = require('../services/branding');
const { getGenAI, getFreeAstroKey, getGeminiKey } = require('../services/clientKeys');
const { calculateVedicChart } = require('../services/vedicChart');
const { parseSinhalaDate, parseSinhalaTime } = require('../services/horoscope');
const { extractFromBuffer } = require('../services/mediaExtractor');
const { analyzePaymentDocument } = require('../services/imageAnalysis');
const { formatChatLog } = require('../utils/chatLog');
const { generateOrderId } = require('../services/gemini');

/** Best-effort mime type for a stored upload from its extension. */
function mimeFor(url, mediaType) {
  const ext = (String(url).split('.').pop() || '').toLowerCase();
  const byExt = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    pdf: 'application/pdf', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', amr: 'audio/amr', wav: 'audio/wav',
  };
  if (byExt[ext]) return byExt[ext];
  return mediaType === 'audio' ? 'audio/ogg' : mediaType === 'pdf' ? 'application/pdf' : 'image/jpeg';
}

/**
 * POST /api/crm/media/reextract  { phone }
 *
 * Re-runs extraction on this customer's stored media messages that have no
 * `extracted` value yet — voice notes get transcribed, slips/PDFs read. For
 * media that arrived before extraction was wired up, or while a transient error
 * skipped it.
 */
async function reextractMedia(req, res) {
  const clientId = resolveClientId(req);
  const { phone } = req.body || {};
  if (!phone)    return res.status(400).json({ error: 'phone required' });
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  try {
    const msgs = await db.getMessagesByPhone(phone, clientId);
    const targets = (msgs || []).filter(m =>
      m.sender_type === 'user' &&
      ['image', 'pdf', 'audio'].includes(m.media_type) &&
      String(m.media_url || '').startsWith('/uploads/') &&
      m.wamid &&
      !m.extracted
    );

    const key = await getGeminiKey(clientId);
    const analyzerOn = await db.hasAddon(clientId, 'image_analyzer').catch(() => false);
    let analyzerCfg = {};
    if (analyzerOn) analyzerCfg = await db.getPluginConfig(clientId, 'image_analyzer').catch(() => ({}));

    let extracted = 0, missing = 0, failed = 0;
    for (const m of targets) {
      const file = path.join(UPLOADS_DIR, path.basename(m.media_url));
      if (!fs.existsSync(file)) { missing++; continue; }
      try {
        const buf = fs.readFileSync(file);
        const mime = mimeFor(m.media_url, m.media_type);
        let result = null;

        if (m.media_type === 'audio') {
          const { text } = await extractFromBuffer(buf, mime, 'voice', null, key);
          if (text && text.trim()) result = { text: text.trim() };
        } else if (analyzerOn) {
          result = await analyzePaymentDocument(buf, mime, analyzerCfg.api_key || key, {
            account: analyzerCfg.expected_account || null,
            bank:    analyzerCfg.expected_bank    || null,
            names:   analyzerCfg.expected_names   || null,
            prompt:  analyzerCfg.extraction_prompt || null,
          });
        } else {
          const { text } = await extractFromBuffer(buf, mime, 'file', null, key);
          if (text && text.trim()) result = { text: text.trim() };
        }

        if (result) { await db.setMessageExtraction(m.wamid, result); extracted++; }
        else failed++;
      } catch (e) {
        console.warn(`[REEXTRACT] ${m.wamid} failed:`, e.message);
        failed++;
      }
    }

    console.log(`[REEXTRACT] ${phone} client=${clientId}: ${extracted}/${targets.length} extracted (${missing} file gone, ${failed} failed)`);
    res.json({ ok: true, candidates: targets.length, extracted, file_missing: missing, failed });
  } catch (e) {
    console.error('[REEXTRACT]', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

/**
 * Fill a tarot request from the chat: every problem the customer actually
 * raised, plus the birth details needed to attach a chart.
 *
 * "problems" is the real output. A Rs 1490 pack is three readings sold at once
 * and the customer states three separate problems, historically all typed into
 * one free-text needs box and then collapsed into a single reading, so two of
 * the three were paid for and never answered. One entry per problem, each a
 * complete brief in its own right, and the operator confirms the split before
 * any order is created.
 *
 * "question" is kept as the first problem's brief so older callers and any
 * half-open drawer keep working unchanged.
 */
const AI_FILL_TAROT_PROMPT = `You are an experienced counsellor preparing the briefs for a tarot session. Read the WhatsApp conversation and the details collected, then return JSON.

"problems" — an ARRAY, one entry per SEPARATE matter this customer is asking about. Most customers raise one. A customer who bought a multi-reading pack usually raises two or three, often written as one run-on line, or numbered "1. … 2. … 3. …", or separated by question marks. Split them. Two questions about the same matter are ONE entry. Two questions about genuinely different areas of life are separate entries. Never invent an entry to reach three, and never merge two unrelated ones. If the chat supports only one, return exactly one entry.
Each entry has:
  "topic" — 2 to 5 words in Sinhala naming the area, e.g. "පවුල හා දරුවා", "නිවස විකිණීම", "ණය ගෙවීම".
  "question" — the full brief for that one matter, written to the rules below.

"question" (inside each entry) — WRITE IT IN SINHALA (Unicode script), always, whatever language the customer used. NOT a restatement of the customer's words: turn their situation into a counsellor-grade brief for the tarot reader. It must:
  - name the one real problem they are living with right now (stay on this ONE topic).
  - lay out the realistic explanations for how it came to this. Think like a counsellor: for most situations only one or two causes are really in play. For example, if a partner suddenly went cold and left "for no reason", the realistic causes are a short list — someone else has entered their life, outside/family pressure or an ultimatum, an untreated mental-health slide (depression, burnout), a long buildup of unspoken resentment that finally broke, or a decision made under someone else's influence. Spell out the shortlist that fits THIS customer's story.
  - state what the reading must determine: what most likely actually happened, the other person's true emotional state now, whether things can realistically recover, and the timing.
  - ask for clear, honest guidance on what the customer should and should not do.
Write it as 3-6 Sinhala sentences, direct and specific to this person. Never invent facts that are not in the chat, but you SHOULD reason about likely causes the customer did not name. The whole "question" value must be Sinhala — no English sentences.

"birth_date_iso": birth date as YYYY-MM-DD, or null if not given.
"birth_time_24h": birth time as HH:MM (24-hour), or null. A vague "morning"/"උදේ" with no number → null.
"birth_place_en": birth town in English, or "".
"lat", "lng": coordinates of that town (0 if unknown).

Details collected so far:
name: {{customer_name}}
birth_date: {{birth_date}}
birth_time: {{birth_time}}
birth_place: {{birth_place}}

Conversation:
{{chat_log}}`;

const LAGNA_SINHALA = {
  Aries: 'මේෂ', Taurus: 'වෘෂභ', Gemini: 'මිථුන', Cancer: 'කටක',
  Leo: 'සිංහ', Virgo: 'කන්නියා', Libra: 'තුලා', Scorpio: 'වෘශ්චික',
  Sagittarius: 'ධනු', Capricorn: 'මකර', Aquarius: 'කුම්භ', Pisces: 'මීන',
};

/**
 * Call freeastro for a birth chart. Never throws — a chart is a bonus for a
 * tarot reading, the cards are the reading.
 *
 * @returns {Promise<{ chart: object|null, sign: string|null }>}
 */
async function fetchTarotChartData(clientId, body) {
  const dateInfo = parseSinhalaDate(String(body.birth_date || ''));
  const timeInfo = parseSinhalaTime(String(body.birth_time || ''));
  if (!dateInfo || !timeInfo || body.lat == null || body.lng == null) {
    return { chart: null, sign: null };
  }
  try {
    const apiKey = await getFreeAstroKey(clientId);
    const { data: chartData } = await calculateVedicChart(
      { year: dateInfo.year, month: dateInfo.month, day: dateInfo.day,
        hour: timeInfo.hour, minute: timeInfo.minute,
        lat: parseFloat(body.lat), lng: parseFloat(body.lng) },
      apiKey
    );
    const sign = (chartData.chart ?? chartData).ascendant?.sign || null;
    return { chart: chartData, sign };
  } catch (e) {
    console.warn('[TAROT] chart fetch failed (non-fatal):', e.message);
    return { chart: null, sign: null };
  }
}

/**
 * Chart to pass Gemini as background context: the one just fetched, or whatever
 * was cached on the order from an earlier fetch.
 *
 * @returns {Promise<{ chartContext: string, chart: object|null }>}
 */
async function buildTarotChart(clientId, orderId, body) {
  let cached = null;
  try {
    const { rows } = await db.pgQuery('SELECT tarot_data FROM orders WHERE order_id=$1', [orderId]);
    const td = (typeof rows[0]?.tarot_data === 'string') ? JSON.parse(rows[0].tarot_data || '{}') : (rows[0]?.tarot_data || {});
    cached = td.chart_data || null;
  } catch { /* ignore */ }

  const haveNew = body.lat != null && body.lng != null && body.birth_date && body.birth_time;
  if (!haveNew) {
    return { chartContext: cached ? JSON.stringify(cached, null, 2) : '', chart: cached };
  }
  const { chart } = await fetchTarotChartData(clientId, body);
  const use = chart || cached;
  return { chartContext: use ? JSON.stringify(use, null, 2) : '', chart: use };
}

/**
 * POST /api/crm/tarot-reading/fetch-chart/:orderId — fetch the chart, save it on
 * the order, and return the ascendant sign so the operator can verify the lagna
 * before generating (mirrors the horoscope fetch-chart step).
 *
 * Body: { birth_date, birth_time, lat, lng, birth_place_name }
 */
async function fetchTarotChart(req, res) {
  const clientId = resolveClientId(req);
  const { orderId } = req.params;
  try {
    const { chart, sign } = await fetchTarotChartData(clientId, req.body);
    if (!chart) return res.status(400).json({ error: 'Could not fetch a chart — need a real birth date, time and place.' });

    let td = {};
    try {
      const { rows } = await db.pgQuery('SELECT tarot_data FROM orders WHERE order_id=$1', [orderId]);
      td = (typeof rows[0]?.tarot_data === 'string') ? JSON.parse(rows[0].tarot_data || '{}') : (rows[0]?.tarot_data || {});
    } catch { /* ignore */ }
    td.chart_data = chart;
    td.birth = {
      birth_date: req.body.birth_date, birth_time: req.body.birth_time,
      lat: req.body.lat, lng: req.body.lng, place: req.body.birth_place_name || '',
    };
    await db.pgQuery('UPDATE orders SET tarot_data=$1 WHERE order_id=$2', [JSON.stringify(td), orderId]);

    res.json({ ok: true, sign, sign_si: LAGNA_SINHALA[sign] || sign });
  } catch (e) {
    console.error('[TAROT-FETCH-CHART]', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

/**
 * POST /api/crm/tarot-reading/ai-prepare/:orderId — read the chat and fill the
 * question box + birth details for a tarot reading.
 */
async function prepareTarotBrief(clientId, order) {
  const cf = (typeof order.custom_fields === 'string') ? JSON.parse(order.custom_fields || '{}') : (order.custom_fields || {});
  const messages = await db.getMessagesByPhone(order.phone_number, clientId);
  // Fold in transcribed voice notes / read slips so the brief is not built
  // from a chat full of "[Voice message]" placeholders.
  const chatLog = formatChatLog(messages);

  const prompt = AI_FILL_TAROT_PROMPT
    .replace('{{customer_name}}', cf.customer_name || cf.b || cf.name || '')
    .replace('{{birth_date}}',    cf.birth_date || '')
    .replace('{{birth_time}}',    cf.birth_time || '')
    .replace('{{birth_place}}',   cf.birth_place || cf.birth_place_name || '')
    .replace('{{chat_log}}',      chatLog || '(no messages found)');

  const model = (await getGenAI(clientId)).getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          problems: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                topic:    { type: 'string' },
                question: { type: 'string' },
              },
              required: ['topic', 'question'],
            },
          },
          birth_date_iso: { type: 'string', nullable: true },
          birth_time_24h: { type: 'string', nullable: true },
          birth_place_en: { type: 'string' },
          lat:            { type: 'number' },
          lng:            { type: 'number' },
        },
        required: ['problems', 'birth_place_en', 'lat', 'lng'],
      },
    },
  });
  const r = await model.generateContent(prompt);
  let parsed;
  try { parsed = JSON.parse(r.response.text().trim()); }
  catch { throw Object.assign(new Error('Gemini returned invalid JSON'), { statusCode: 500 }); }

  // Drop blanks rather than letting an empty brief become an order nobody can read.
  const problems = (Array.isArray(parsed.problems) ? parsed.problems : [])
    .map(p => ({ topic: String(p?.topic || '').trim(), question: String(p?.question || '').trim() }))
    .filter(p => p.question);

  return {
    problems,
    // The first brief, so callers that only know about one question are unaffected.
    question:       problems[0]?.question || '',
    birth_date_iso: parsed.birth_date_iso || null,
    birth_time_24h: parsed.birth_time_24h || null,
    birth_place_en: parsed.birth_place_en || null,
    lat:            parsed.lat || null,
    lng:            parsed.lng || null,
  };
}

async function aiPrepareTarot(req, res) {
  const clientId = resolveClientId(req);
  const { orderId } = req.params;
  try {
    const oRes = await db.pgQuery('SELECT * FROM orders WHERE order_id=$1', [orderId]);
    if (!oRes.rows.length) return res.status(404).json({ error: 'Order not found' });
    res.json(await prepareTarotBrief(clientId, oRes.rows[0]));
  } catch (e) {
    console.error('[TAROT-AI-PREPARE]', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

/**
 * POST /api/crm/tarot-reading/split-pack/:orderId — turn the problems the
 * operator confirmed into one order per problem.
 *
 * A multi-reading pack is sold and paid once, so the money stays on the order
 * that already carries it and every sibling is created at price 0. Three orders
 * appear on the board and in the delivery queue; income is still counted once.
 * Getting this wrong would report Rs 2,980 that nobody paid.
 *
 * Siblings inherit the parent's status: a pack paid for in full is not three
 * unpaid orders, and showing it that way would inflate the pending pipeline.
 *
 * Body: { problems: [{ topic, question }] } — index 0 stays on this order.
 */
async function splitTarotPack(req, res) {
  const clientId = resolveClientId(req);
  const { orderId } = req.params;
  const problems = Array.isArray(req.body?.problems) ? req.body.problems : [];

  const clean = problems
    .map(p => ({ topic: String(p?.topic || '').trim(), question: String(p?.question || '').trim() }))
    .filter(p => p.question);
  if (clean.length < 2) {
    return res.status(400).json({ error: 'Need at least two problems to split into separate orders' });
  }

  try {
    const oRes = clientId
      ? await db.pgQuery('SELECT * FROM orders WHERE order_id=$1 AND client_id=$2', [orderId, clientId])
      : await db.pgQuery('SELECT * FROM orders WHERE order_id=$1', [orderId]);
    const parent = oRes.rows[0];
    if (!parent) return res.status(404).json({ error: 'Order not found' });

    const pcf = typeof parent.custom_fields === 'string'
      ? JSON.parse(parent.custom_fields || '{}') : (parent.custom_fields || {});

    // Splitting twice would create duplicate siblings for the same problems.
    if (pcf.tarot_pack?.pack_id) {
      return res.status(409).json({
        error: `This order is already part of pack ${pcf.tarot_pack.pack_id} (reading ${pcf.tarot_pack.seq} of ${pcf.tarot_pack.of}). Delete the sibling orders first if you need to re-split.`,
      });
    }

    const packId = `${parent.order_id}-P`;
    const client = clientId ? await clientRouter.getClientById(clientId) : null;
    const created = [];

    // Siblings first. If one fails the parent is untouched and the operator can
    // retry, rather than being left with a parent that claims siblings that do
    // not exist.
    for (let i = 1; i < clean.length; i++) {
      const sibId = await generateOrderId(client);
      const cf = {
        ...pcf,
        needs: clean[i].question,
        // The pack was paid once, on the parent. A sibling priced at its share
        // would report income that never arrived.
        price: '0',
        items: [],
        tarot_pack: { pack_id: packId, seq: i + 1, of: clean.length, parent: parent.order_id, topic: clean[i].topic },
      };
      delete cf.price_backfilled;
      await db.insertOrder(sibId, parent.phone_number, clientId || null, cf);
      await db.pgQuery('UPDATE orders SET status=$1 WHERE order_id=$2', [parent.status, sibId]);
      created.push({ order_id: sibId, seq: i + 1, topic: clean[i].topic });
    }

    const parentCf = {
      ...pcf,
      needs: clean[0].question,
      tarot_pack: { pack_id: packId, seq: 1, of: clean.length, parent: parent.order_id, topic: clean[0].topic },
    };
    await db.pgQuery('UPDATE orders SET custom_fields=$2::jsonb WHERE order_id=$1',
      [parent.order_id, JSON.stringify(parentCf)]);

    console.log(`[TAROT-PACK] ${packId}: ${clean.length} readings, created ${created.map(c => c.order_id).join(', ')}`);
    res.json({ ok: true, pack_id: packId, of: clean.length, parent: parent.order_id, created });
  } catch (e) {
    console.error('[TAROT-SPLIT-PACK]', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

/**
 * POST /api/orders/ai-fill-draft — read the chat and suggest values for the
 * Create Order form. Nothing is created: the operator reviews the values in the
 * drawer and presses Create.
 *
 * Body: { phone }. Returns { customer_name, product_id, fields: { key: value } }.
 */
async function aiFillOrderDraft(req, res) {
  const clientId = resolveClientId(req);
  const phone = String(req.body?.phone || '').trim();
  if (!phone) return res.status(400).json({ error: 'phone required' });
  try {
    const cfg = await db.pgQuery('SELECT order_fields FROM client_configs WHERE client_id=$1', [clientId ?? null]);
    let orderFields = cfg.rows[0]?.order_fields || [];
    if (typeof orderFields === 'string') { try { orderFields = JSON.parse(orderFields); } catch { orderFields = []; } }
    const prods = await db.pgQuery(
      'SELECT id, name, price FROM client_products WHERE client_id=$1 AND active ORDER BY sort_order, id', [clientId ?? null]);

    const parse = v => (typeof v === 'string' ? JSON.parse(v || '{}') : (v || {}));
    const earlier = await db.pgQuery(
      `SELECT order_id, created_at, custom_fields FROM orders
        WHERE phone_number=$1 AND client_id=$2 ORDER BY created_at DESC LIMIT 3`, [phone, clientId ?? null]);
    const chatLog = formatChatLog(await db.getMessagesByPhone(phone, clientId));

    const fieldLines = [
      '- customer_name: full name',
      ...orderFields.map(f => `- ${f.key}: ${f.label}`),
    ].join('\n');
    const prompt = `You fill in an order form for a WhatsApp business from the customer's chat. Return JSON only.

Form fields (use these exact keys inside "fields"):
${fieldLines}

Services for sale (choose "product_id" from these ids, or null if the customer has not clearly chosen one):
${prods.rows.map(p => `${p.id}: ${p.name} (Rs ${Number(p.price) || 0})`).join('\n') || '(none)'}

The customer's earlier orders, newest first (their name and birth details are usually unchanged):
${earlier.rows.map(r => `${r.order_id}: ${JSON.stringify(parse(r.custom_fields))}`).join('\n') || '(none)'}

Rules:
- This is a NEW order. Base every problem/question/request field on what the customer is asking for in the LATEST messages, not on old requests already handled.
- Write problem/question fields as a short, specific note in the same language the form uses (Sinhala if the earlier orders are Sinhala). Never invent facts that are not in the chat.
- Copy name and birth details from the chat, or from earlier orders when the chat does not repeat them. Use "" when unknown.
- Every key in "fields" must be one of the form keys above.

Return: {"customer_name": string, "product_id": number|null, "fields": {key: string}}

Chat:
${chatLog || '(no messages found)'}`;

    const model = (await getGenAI(clientId)).getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    });
    const r = await model.generateContent(prompt);
    let parsed;
    try { parsed = JSON.parse(r.response.text().trim()); }
    catch { return res.status(500).json({ error: 'Gemini returned invalid JSON' }); }

    const keys = new Set(orderFields.map(f => f.key));
    const fields = {};
    for (const [k, v] of Object.entries(parsed.fields || {})) {
      if (keys.has(k) && v != null && String(v).trim()) fields[k] = String(v).trim();
    }
    const validProduct = prods.rows.find(p => Number(p.id) === Number(parsed.product_id));
    res.json({
      customer_name: String(parsed.customer_name || '').trim(),
      product_id: validProduct ? String(validProduct.id) : null,
      fields,
    });
  } catch (e) {
    console.error('[ORDER-AI-FILL]', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

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

    await db.insertMessage(phone, msgText, 'bot', null, clientId, mediaType, fileUrl, wamid, null, { sentBy: req.user?.uid ?? null, sentManual: true });
    res.json({ ok: true, url: fileUrl });
  } catch (e) {
    console.error('[CRM MEDIA] send-media error:', e.message);
    res.status(500).json({ error: e?.response?.data?.error?.message || e.message });
  }
}

/**
 * Load the earlier tarot readings an operator linked to this order, formatted as
 * context for Gemini. Only orders of the same customer and client qualify, so a
 * forged id can never pull in someone else's reading.
 *
 * @param {string}   clientId
 * @param {string}   orderId   The order being generated (excluded from its own chain)
 * @param {string[]} linkedIds Order ids chosen by the operator
 * @returns {Promise<{ text: string, ids: string[] }>}
 */
async function loadLinkedReadings(clientId, orderId, linkedIds) {
  const wanted = (Array.isArray(linkedIds) ? linkedIds : []).map(String).filter(id => id && id !== String(orderId));
  if (!wanted.length) return { text: '', ids: [] };
  const own = await db.pgQuery('SELECT phone_number FROM orders WHERE order_id=$1 AND client_id=$2', [orderId, clientId ?? null]);
  const phone = own.rows[0]?.phone_number;
  if (!phone) return { text: '', ids: [] };
  const { rows } = await db.pgQuery(
    `SELECT order_id, created_at, tarot_data FROM orders
      WHERE order_id = ANY($1) AND phone_number=$2 AND client_id=$3
      ORDER BY created_at ASC`,
    [wanted, phone, clientId ?? null]);
  const parts = [];
  const ids = [];
  for (const r of rows) {
    const td = typeof r.tarot_data === 'string' ? JSON.parse(r.tarot_data || '{}') : (r.tarot_data || {});
    if (!td.reading) continue;
    const cards = (td.cards || []).map(c => `${c.position}: ${c.sinhala_name || c.name}${c.reversed ? ' (Reversed)' : ''}`).join(', ');
    const when = r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : 'unknown date';
    parts.push(`### Order ${r.order_id} (${when})\nQuestion: ${td.question || ''}\nCards: ${cards}\nReading:\n${td.reading}`);
    ids.push(r.order_id);
  }
  return { text: parts.join('\n\n'), ids };
}

/**
 * GET /api/crm/tarot-reading/linkable/:orderId — the same customer's other tarot
 * orders that already have a reading, for the "link to previous" picker.
 */
async function listLinkableTarot(req, res) {
  try {
    const clientId = resolveClientId(req);
    const orderId = req.params.orderId;
    const own = await db.pgQuery('SELECT phone_number, custom_fields FROM orders WHERE order_id=$1 AND client_id=$2', [orderId, clientId ?? null]);
    const phone = own.rows[0]?.phone_number;
    if (!phone) return res.json({ orders: [], pack: null });
    // Siblings of the same pack come back even with no reading yet. Until now
    // the picker listed only orders that already carried a generated reading,
    // so the second reading of a pack saw nothing and the operator was told
    // "no earlier tarot readings found" while looking at a customer who had
    // clearly bought three. A sibling that is not generated cannot be fed to
    // Gemini, but the operator has to be able to see it exists.
    const { rows } = await db.pgQuery(
      `SELECT order_id, created_at, tarot_data, custom_fields FROM orders
        WHERE phone_number=$1 AND client_id=$2 AND order_id<>$3
          AND (tarot_data IS NOT NULL OR custom_fields->'tarot_pack' IS NOT NULL)
        ORDER BY created_at`,
      [phone, clientId ?? null, orderId]);

    const ownCf = typeof own.rows[0].custom_fields === 'string'
      ? JSON.parse(own.rows[0].custom_fields || '{}') : (own.rows[0].custom_fields || {});
    const ownPack = ownCf.tarot_pack?.pack_id || null;

    const orders = [];
    for (const r of rows) {
      const td = typeof r.tarot_data === 'string' ? JSON.parse(r.tarot_data || '{}') : (r.tarot_data || {});
      const cf = typeof r.custom_fields === 'string' ? JSON.parse(r.custom_fields || '{}') : (r.custom_fields || {});
      const pack = cf.tarot_pack || null;
      const samePack = !!(ownPack && pack?.pack_id === ownPack);
      if (!td.reading && !samePack) continue;
      orders.push({
        order_id:  r.order_id,
        created_at: r.created_at,
        // Before generation there is no reading, so show what it is going to be about.
        question:  td.question || cf.needs || '',
        has_reading: !!td.reading,
        same_pack: samePack,
        pack_seq:  pack?.seq || null,
        pack_of:   pack?.of  || null,
        topic:     pack?.topic || '',
        linked_order_ids: td.linked_order_ids || [],
      });
    }
    // Same pack first and in reading order, then everything else newest first.
    orders.sort((a, b) =>
      (b.same_pack - a.same_pack) ||
      (a.same_pack ? a.pack_seq - b.pack_seq : new Date(b.created_at) - new Date(a.created_at)));
    res.json({ orders, pack: ownPack ? { pack_id: ownPack, seq: ownCf.tarot_pack.seq, of: ownCf.tarot_pack.of } : null });
  } catch (e) {
    console.error('[TAROT-LINKABLE]', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
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
  const { phone, question, order_id, regenerate, linked_order_ids } = req.body;

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

    // Keep any chart already fetched for this order so the "generating" placeholder
    // does not wipe it.
    const linked = await loadLinkedReadings(clientId, order_id, linked_order_ids);
    let priorChart = null;
    try {
      const p = await db.pgQuery(`SELECT tarot_data FROM orders WHERE order_id=$1`, [order_id]);
      const ptd = (typeof p.rows[0]?.tarot_data === 'string') ? JSON.parse(p.rows[0].tarot_data || '{}') : (p.rows[0]?.tarot_data || {});
      priorChart = ptd.chart_data || null;
    } catch { /* ignore */ }

    // Mark as generating so frontend can show progress
    await db.pgQuery(
      `UPDATE orders SET tarot_data=$1 WHERE order_id=$2`,
      [JSON.stringify({ generating: true, question, linked_order_ids: linked.ids, ...(priorChart && { chart_data: priorChart }) }), order_id]
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
    const { chartContext, chart } = await buildTarotChart(clientId, order_id, req.body);
    generateTarotReading(clientId, question, customPrompt, order_id, chartContext, linked.text).then(async ({ reading, cards }) => {
      const tarotData = { question, reading, cards, linked_order_ids: linked.ids, generated_at: new Date().toISOString(), ...(chart && { chart_data: chart }) };
      await db.pgQuery(
        `UPDATE orders SET tarot_data=$1 WHERE order_id=$2`,
        [JSON.stringify(tarotData), order_id]
      ).catch(e => console.warn('[TAROT] Failed to save tarot_data:', e.message));
      console.log(`[TAROT] Background generation complete for order ${order_id}`);
    }).catch(async (e) => {
      console.error('[TAROT] Background generation error:', e.message);
      await db.pgQuery(
        `UPDATE orders SET tarot_data=$1 WHERE order_id=$2`,
        [JSON.stringify({ error: e.message, question, linked_order_ids: linked.ids }), order_id]
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
  const { reading, cards, question } = req.body;
  try {
    const existing = await db.pgQuery('SELECT tarot_data FROM orders WHERE order_id=$1', [orderId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Order not found' });
    const td = (typeof existing.rows[0].tarot_data === 'string')
      ? JSON.parse(existing.rows[0].tarot_data || '{}')
      : (existing.rows[0].tarot_data || {});
    if (reading  !== undefined) td.reading  = reading;
    if (cards    !== undefined) td.cards    = cards;
    if (question !== undefined) td.question = question;
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
  addonCatalog, ADDON_CATALOG, listAddons, toggleAddon, getAddonsStatus, sendMedia, reextractMedia, triggerTarotReading, listLinkableTarot, aiFillOrderDraft, aiPrepareTarot, splitTarotPack, fetchTarotChart, updateTarotSections, downloadTarotDocx, downloadTarotPdfByOrder, downloadTarotPdf };
