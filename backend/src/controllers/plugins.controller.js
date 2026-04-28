/**
 * @module controllers/plugins.controller
 * @description Handlers for the plugin configuration API
 * (get/set config, get customer data, generate astro chart message).
 */

'use strict';

const db   = require('../db');
const { generateAstroMessage, DEFAULT_ASTRO_PROMPT } = require('../services/astro');
const { generateHoroscope, buildHoroscopeDoc, SECTIONS, parseSinhalaDate } = require('../services/horoscope');
const { analyzeAura } = require('../services/quantumCode');
const { DEFAULT_TAROT_PROMPT } = require('../services/tarot');
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
    let defaults;
    if (pluginId === 'astro_vedic_chart') {
      defaults = { name: 'Vedic Astro Chart', prompt: DEFAULT_ASTRO_PROMPT };
    } else if (pluginId === 'horoscope_reading') {
      defaults = { name: 'Horoscope Reading', system_prompt: '', special_note: '', api_key: '' };
    } else if (pluginId === 'ai_call_answering') {
      defaults = { name: 'AI Call Answering', system_prompt: '', greeting: 'Hello, how can I help you today?', tts_voice: 'Kore', stt_language: 'en-US' };
    } else if (pluginId === 'image_analyzer') {
      defaults = {
        name: 'Image Analyzer',
        verification_prompt: 'When a customer sends a payment slip:\n1. The amount and date must match one of their pending orders. Do NOT check the payer name — payments may be made by someone else on behalf of the customer.\n2. If the amount and date look correct and no fraud flags are raised, tell the customer their payment is received and being verified by the team. Then output: [[PAYMENT_IDENTIFIED:{"order_id":"ORDER_ID_HERE","amount":"AMOUNT","date":"DATE","bank":"BANK","ref":"REF"}]]\n3. If there are FRAUD CHECK flags (suspicious date etc.), politely ask the customer to clarify — do not accuse them. Output: [[UPDATE_SUMMARY:⚠️ SUSPICIOUS PAYMENT — Team review needed. Describe what was suspicious.]]\n4. If the amount does not match any pending order, politely ask the customer to check and clarify.\n5. Always mention the extracted amount and date so the customer can confirm.',
      };
    } else if (pluginId === 'tarot_reading') {
      const { DEFAULT_PAGE1_BODY, DEFAULT_PAGE2_BODY, DEFAULT_PAGE4_BODY } = require('../services/tarot');
      defaults = { name: 'Tarot Reading', prompt: DEFAULT_TAROT_PROMPT, page1_body: DEFAULT_PAGE1_BODY, page2_body: DEFAULT_PAGE2_BODY, page4_body: DEFAULT_PAGE4_BODY };
    } else {
      defaults = { name: pluginId, prompt: '' };
    }
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
  const { name, prompt, api_key, system_prompt, special_note, greeting, tts_voice, stt_language, verification_prompt, page1_body, page2_body, page4_body } = req.body;
  try {
    const existing = await db.getPluginConfig(clientId, pluginId);
    const update = { ...existing };
    if (name !== undefined)          update.name          = name;
    if (prompt !== undefined)        update.prompt        = prompt;
    if (api_key !== undefined)       update.api_key       = api_key;
    if (system_prompt !== undefined) update.system_prompt = system_prompt;
    if (special_note !== undefined)  update.special_note  = special_note;
    if (greeting !== undefined)      update.greeting      = greeting;
    if (tts_voice !== undefined)     update.tts_voice     = tts_voice;
    if (stt_language !== undefined)         update.stt_language         = stt_language;
    if (verification_prompt !== undefined)  update.verification_prompt  = verification_prompt;
    if (page1_body !== undefined)    update.page1_body    = page1_body;
    if (page2_body !== undefined)    update.page2_body    = page2_body;
    if (page4_body !== undefined)    update.page4_body    = page4_body;
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

/**
 * POST /api/plugins/horoscope/analyze-aura — run Gemini Vision aura analysis on a selfie.
 *
 * Accepts multipart/form-data with field "image".
 * Saves result to horoscope_data.aura_analysis (reuses saved result unless ?override=1).
 * Returns the aura_analysis JSON so the frontend can display it immediately.
 */
async function analyzeAuraImage(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  const { order_id, override } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id required' });
  if (!req.file)  return res.status(400).json({ error: 'image file required' });

  try {
    // Load existing horoscope_data
    const r = await db.pgQuery(
      'SELECT horoscope_data FROM orders WHERE order_id=$1',
      [order_id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found' });

    const hd = (typeof r.rows[0].horoscope_data === 'string')
      ? JSON.parse(r.rows[0].horoscope_data || '{}')
      : (r.rows[0].horoscope_data || {});

    // Return cached result unless override is explicitly requested
    if (hd.aura_analysis && override !== '1' && override !== 'true') {
      console.log('[AURA] Returning cached aura_analysis for order', order_id);
      return res.json({ aura_analysis: hd.aura_analysis, cached: true });
    }

    const config  = await db.getPluginConfig(clientId, 'horoscope_reading');
    const apiKey  = config.gemini_api_key || process.env.GEMINI_API_KEY;

    const auraAnalysis = await analyzeAura(req.file.buffer, req.file.mimetype, apiKey);

    // Save to horoscope_data.aura_analysis (jsonb_set preserves all other keys)
    await db.pgQuery(
      `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}'), '{aura_analysis}', $1::jsonb) WHERE order_id=$2`,
      [JSON.stringify(auraAnalysis), order_id]
    );

    console.log('[AURA] Saved aura_analysis for order', order_id, '| af_score:', auraAnalysis.af_score);
    res.json({ aura_analysis: auraAnalysis, cached: false });
  } catch (e) {
    console.error('[AURA] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /api/plugins/horoscope/generate — generate full horoscope reading for an order.
 */
async function generateHoroscopeReading(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  const {
    order_id, lat, lng, birth_place_name, birth_overrides,
    override_astro, special_questions, package_type,
    include_quantum, active_name,
  } = req.body;
  if (!order_id || lat == null || lng == null) {
    return res.status(400).json({ error: 'order_id, lat, lng required' });
  }
  if (include_quantum && !active_name?.trim()) {
    return res.status(400).json({ error: 'active_name required when include_quantum is true' });
  }

  const addonCheck = await db.pgQuery(
    `SELECT enabled FROM client_addons WHERE client_id=$1 AND addon_id='horoscope_reading' AND enabled=TRUE`,
    [clientId]
  );
  if (!addonCheck.rows.length) return res.status(403).json({ error: 'horoscope_reading addon not enabled' });

  // Mark as generating immediately so the frontend can show progress
  if (db.IS_PG) {
    await db.pgQuery(
      `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}'), '{generating}', 'true'::jsonb) WHERE order_id=$1`,
      [order_id]
    ).catch(() => {});
  }

  // Return immediately — generation runs in background
  res.json({ ok: true, generating: true });

  generateHoroscope(
    clientId, order_id,
    birth_overrides || {},
    lat, lng,
    birth_place_name || '',
    !!override_astro,
    Array.isArray(special_questions) ? special_questions : [],
    package_type === '1500',
    !!include_quantum,
    (active_name || '').trim()
  ).catch(async (e) => {
    console.error('[HOROSCOPE] generate error:', e.message);
    const detail = e?.response?.data?.detail;
    const msg = Array.isArray(detail)
      ? detail.map(d => `${d.loc?.slice(-1)?.[0] || 'field'}: ${d.msg}`).join('; ')
      : (typeof detail === 'string' ? detail : e.message);
    // Save error state so the frontend can show it
    if (db.IS_PG) {
      await db.pgQuery(
        `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}') - 'generating', '{error}', $1::jsonb) WHERE order_id=$2`,
        [JSON.stringify(msg), order_id]
      ).catch(() => {});
    }
  });
}

/**
 * PATCH /api/plugins/horoscope/sections/:orderId — update saved section text.
 */
async function updateHoroscopeSections(req, res) {
  const { orderId } = req.params;
  const { sections, special_answers } = req.body;
  try {
    const existing = await db.pgQuery(
      'SELECT horoscope_data FROM orders WHERE order_id=$1', [orderId]
    );
    if (!existing.rows.length) return res.status(404).json({ error: 'Order not found' });
    const hd = (typeof existing.rows[0].horoscope_data === 'string')
      ? JSON.parse(existing.rows[0].horoscope_data || '{}')
      : (existing.rows[0].horoscope_data || {});
    if (sections)        hd.sections        = { ...(hd.sections || {}), ...sections };
    if (special_answers) hd.special_answers = special_answers;
    await db.pgQuery('UPDATE orders SET horoscope_data=$1 WHERE order_id=$2', [JSON.stringify(hd), orderId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * GET /api/plugins/horoscope/download/:orderId — stream .docx for an order.
 */
async function downloadHoroscope(req, res) {
  const { orderId } = req.params;
  try {
    const r = await db.pgQuery(
      'SELECT phone_number, custom_fields, horoscope_data FROM orders WHERE order_id=$1', [orderId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found' });
    const hd = (typeof r.rows[0].horoscope_data === 'string')
      ? JSON.parse(r.rows[0].horoscope_data || '{}')
      : (r.rows[0].horoscope_data || {});
    if (!hd.sections) return res.status(404).json({ error: 'No horoscope data yet' });

    const cf = (typeof r.rows[0].custom_fields === 'string')
      ? JSON.parse(r.rows[0].custom_fields || '{}')
      : (r.rows[0].custom_fields || {});

    const clientId = resolveClientId(req);
    const config = clientId ? await db.getPluginConfig(clientId, 'horoscope_reading') : {};

    const buffer = await buildHoroscopeDoc({
      customerName:   cf.customer_name || '',
      sections:       hd.sections,
      specialAnswers: hd.special_answers  || [],
      specialNote:    config.special_note || '',
      quantumData:    hd.quantum_data     || null,
      auraAnalysis:   hd.aura_analysis    || null,
      quantumReading: hd.quantum_reading  || null,
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const phone    = (r.rows[0].phone_number || orderId).replace(/\D/g, '');
    const last4    = phone.slice(-4) || '0000';
    const parsed   = parseSinhalaDate(cf.birth_date || '');
    const birthday = parsed
      ? `${parsed.year}${String(parsed.month).padStart(2,'0')}${String(parsed.day).padStart(2,'0')}`
      : 'birthday';
    const filename = `horoscope-${last4}-${birthday}.docx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * GET /api/plugins/horoscope/download-pdf/:orderId — stream PDF for an order.
 */
async function downloadHoroscopePdf(req, res) {
  const { orderId } = req.params;
  try {
    const r = await db.pgQuery(
      'SELECT phone_number, custom_fields, horoscope_data FROM orders WHERE order_id=$1', [orderId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found' });
    const hd = (typeof r.rows[0].horoscope_data === 'string')
      ? JSON.parse(r.rows[0].horoscope_data || '{}')
      : (r.rows[0].horoscope_data || {});
    if (!hd.sections) return res.status(404).json({ error: 'No horoscope data yet' });

    const cf = (typeof r.rows[0].custom_fields === 'string')
      ? JSON.parse(r.rows[0].custom_fields || '{}')
      : (r.rows[0].custom_fields || {});

    const clientId = resolveClientId(req);
    const config = clientId ? await db.getPluginConfig(clientId, 'horoscope_reading') : {};

    const docxBuffer = await buildHoroscopeDoc({
      customerName:   cf.customer_name || '',
      sections:       hd.sections,
      specialAnswers: hd.special_answers  || [],
      specialNote:    config.special_note || '',
      quantumData:    hd.quantum_data     || null,
      auraAnalysis:   hd.aura_analysis    || null,
      quantumReading: hd.quantum_reading  || null,
    });

    const { exec } = require('child_process');
    const fs   = require('fs');
    const os   = require('os');
    const path = require('path');
    const uid  = `${orderId}-${Date.now()}`;
    const tmpHome = path.join(os.tmpdir(), `lo-home-${uid}`);
    const tmpDocx = path.join(os.tmpdir(), `horo-${uid}.docx`);
    const tmpPdf  = path.join(os.tmpdir(), `horo-${uid}.pdf`);

    // Copy fonts into all locations LibreOffice checks
    const fontSrc = path.join(__dirname, '../assets/fonts');
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

    fs.writeFileSync(tmpDocx, docxBuffer);
    await new Promise((resolve, reject) => {
      exec(
        `fc-cache -f "${fontDest}" 2>/dev/null; soffice --headless --convert-to pdf --outdir "${os.tmpdir()}" "${tmpDocx}"`,
        { env: { ...process.env, HOME: tmpHome } },
        (err, _stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve();
        }
      );
    });

    // Update PDF metadata to hide software origin
    const { PDFDocument } = require('pdf-lib');
    const rawPdf = fs.readFileSync(tmpPdf);
    const pdfDoc = await PDFDocument.load(rawPdf);
    pdfDoc.setTitle('පුරාණ ජෝතිර්වේදය හදහන් සේවය');
    pdfDoc.setAuthor('පුරාණ ජෝතිර්වේදය හදහන් සේවය');
    pdfDoc.setCreator('පුරාණ ජෝතිර්වේදය');
    pdfDoc.setProducer('පුරාණ ජෝතිර්වේදය');
    pdfDoc.setSubject('ජෝතිෂ්‍ය පඨනය');
    pdfDoc.setKeywords([]);
    const buffer = Buffer.from(await pdfDoc.save());
    fs.rm(tmpHome, { recursive: true, force: true }, () => {});
    fs.unlink(tmpDocx, () => {});
    fs.unlink(tmpPdf, () => {});

    const phone  = (r.rows[0].phone_number || orderId).replace(/\D/g, '');
    const last4  = phone.slice(-4) || '0000';
    const rawBirth = hd.birth_overrides?.birth_date || cf.birth_date || '';
    const parsed = parseSinhalaDate(rawBirth);
    const birthday = parsed
      ? `${parsed.year}${String(parsed.month).padStart(2,'0')}${String(parsed.day).padStart(2,'0')}`
      : rawBirth.replace(/[^0-9]/g, '').slice(0, 8) || 'birthday';
    const filename = `${phone}-${birthday}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = {
  getPluginConfig, updatePluginConfig, getPluginCustomerData, generateAstroChart,
  analyzeAuraImage,
  generateHoroscopeReading, updateHoroscopeSections, downloadHoroscope, downloadHoroscopePdf,
};
