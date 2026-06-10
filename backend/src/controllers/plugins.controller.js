/**
 * @module controllers/plugins.controller
 * @description Handlers for the plugin configuration API
 * (get/set config, get customer data, generate astro chart message).
 */

'use strict';

const db   = require('../db');
const { generateAstroMessage, DEFAULT_ASTRO_PROMPT } = require('../services/astro');
const { generateHoroscope, buildHoroscopeDoc, buildQuantumDoc, regenerateHoroscopeSection, generateWaMessage, SECTIONS, SECTION_GUIDES, parseSinhalaDate, parseSinhalaTime } = require('../services/horoscope');
const { analyzeAura, generateQuantumReading, generateQuantumSections } = require('../services/quantumCode');
const { DEFAULT_TAROT_PROMPT } = require('../services/tarot');
const resolveClientId = require('../middleware/resolveClientId');

const { exec } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

function findSoffice() {
  if (process.platform !== 'win32') return 'soffice';
  const candidates = [
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files\\LibreOffice 7\\program\\soffice.exe',
    'C:\\Program Files\\LibreOffice 6\\program\\soffice.exe',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) { console.log('[PDF] Found soffice at', c); return `"${c}"`; }
  }
  throw new Error('LibreOffice not found on this machine. Install it from https://www.libreoffice.org/download/download/ — PDF generation requires LibreOffice.');
}

async function convertDocxToPdf(tmpDocx, outDir, tmpHome, fontDir) {
  const soffice = findSoffice();
  console.log(`[PDF] platform=${process.platform}  soffice=${soffice}  tmpDocx=${tmpDocx}  outDir=${outDir}`);

  if (process.platform !== 'win32') {
    await new Promise(resolve =>
      exec(`fc-cache -f "${fontDir}"`, { env: { ...process.env, HOME: tmpHome } }, (err, stdout, stderr) => {
        if (err) console.warn('[PDF] fc-cache warning:', stderr || err.message);
        resolve();
      })
    );
  }

  await new Promise((resolve, reject) =>
    exec(
      `${soffice} --headless --convert-to pdf --outdir "${outDir}" "${tmpDocx}"`,
      { env: { ...process.env, HOME: tmpHome } },
      (err, stdout, stderr) => {
        console.log('[PDF] soffice stdout:', stdout);
        if (stderr) console.log('[PDF] soffice stderr:', stderr);
        if (err) {
          console.error('[PDF] soffice error:', err.message);
          reject(new Error(stderr || err.message));
        } else {
          resolve();
        }
      }
    )
  );
}

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
      defaults = { name: 'Horoscope Reading', system_prompt: '', quantum_system_prompt: '', aura_system_prompt: '', horoscope_sections: [], quantum_sections: [], section_guides: SECTION_GUIDES, special_note: '', api_key: '', wa_message_prompt: '', quantum_enabled: true };
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
  const { name, prompt, api_key, system_prompt, quantum_system_prompt, aura_system_prompt, horoscope_sections, quantum_sections, section_guides, special_note, wa_message_prompt, greeting, tts_voice, stt_language, verification_prompt, page1_body, page2_body, page4_body, quantum_enabled } = req.body;
  try {
    const existing = await db.getPluginConfig(clientId, pluginId);
    const update = { ...existing };
    if (name !== undefined)          update.name          = name;
    if (prompt !== undefined)        update.prompt        = prompt;
    if (api_key !== undefined)       update.api_key       = api_key;
    if (system_prompt !== undefined)         update.system_prompt         = system_prompt;
    if (quantum_system_prompt !== undefined) update.quantum_system_prompt = quantum_system_prompt;
    if (aura_system_prompt !== undefined)    update.aura_system_prompt    = aura_system_prompt;
    if (horoscope_sections !== undefined)    update.horoscope_sections    = horoscope_sections;
    if (quantum_sections !== undefined)      update.quantum_sections      = quantum_sections;
    if (section_guides !== undefined)        update.section_guides        = section_guides;
    if (special_note !== undefined)          update.special_note          = special_note;
    if (wa_message_prompt !== undefined)     update.wa_message_prompt     = wa_message_prompt;
    if (quantum_enabled !== undefined)       update.quantum_enabled       = quantum_enabled;
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

    const auraAnalysis = await analyzeAura(req.file.buffer, req.file.mimetype, apiKey, config.aura_system_prompt || '');

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
    include_quantum, active_name, selected_sections,
  } = req.body;
  if (!order_id || lat == null || lng == null) {
    return res.status(400).json({ error: 'order_id, lat, lng required' });
  }
  const addonCheck = await db.pgQuery(
    `SELECT enabled FROM client_addons WHERE client_id=$1 AND addon_id='horoscope_reading' AND enabled=TRUE`,
    [clientId]
  );
  if (!addonCheck.rows.length) return res.status(403).json({ error: 'horoscope_reading addon not enabled' });

  // Enforce server-side: ignore include_quantum if the feature is disabled in config
  const pluginCfg = await db.getPluginConfig(clientId, 'horoscope_reading');
  const effectiveIncludeQuantum = pluginCfg.quantum_enabled !== false ? !!include_quantum : false;

  if (effectiveIncludeQuantum && !active_name?.trim()) {
    return res.status(400).json({ error: 'active_name required when include_quantum is true' });
  }

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
    true,
    effectiveIncludeQuantum,
    (active_name || '').trim(),
    Array.isArray(selected_sections) && selected_sections.length > 0 ? selected_sections : null
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
      birthDate:      cf.birth_date || '',
      birthTime:      cf.birth_time || '',
      sectionOrder:   config.horoscope_sections || [],
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
      birthDate:      cf.birth_date || '',
      birthTime:      cf.birth_time || '',
      sectionOrder:   config.horoscope_sections || [],
    });

    const uid  = `${orderId}-${Date.now()}`;
    const tmpHome = path.join(os.tmpdir(), `lo-home-${uid}`);
    const tmpDocx = path.join(os.tmpdir(), `horo-${uid}.docx`);
    const tmpPdf  = path.join(os.tmpdir(), `horo-${uid}.pdf`);

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

    fs.writeFileSync(tmpDocx, docxBuffer);
    await convertDocxToPdf(tmpDocx, os.tmpdir(), tmpHome, fontDirs[0]);

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

/**
 * PATCH /api/plugins/horoscope/quantum-sections/:orderId — update saved quantum section content.
 */
async function updateQuantumSections(req, res) {
  const { orderId } = req.params;
  const { quantum_sections_data } = req.body;
  try {
    const existing = await db.pgQuery(
      'SELECT horoscope_data FROM orders WHERE order_id=$1', [orderId]
    );
    if (!existing.rows.length) return res.status(404).json({ error: 'Order not found' });
    const hd = (typeof existing.rows[0].horoscope_data === 'string')
      ? JSON.parse(existing.rows[0].horoscope_data || '{}')
      : (existing.rows[0].horoscope_data || {});
    if (quantum_sections_data !== undefined) hd.quantum_sections_data = quantum_sections_data;
    await db.pgQuery('UPDATE orders SET horoscope_data=$1 WHERE order_id=$2', [JSON.stringify(hd), orderId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * GET /api/plugins/horoscope/download-quantum-docx/:orderId — stream raw Quantum+Aura .docx for preview.
 */
async function downloadQuantumDocx(req, res) {
  const { orderId } = req.params;
  try {
    const r = await db.pgQuery(
      'SELECT custom_fields, horoscope_data FROM orders WHERE order_id=$1', [orderId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found' });
    const hd = (typeof r.rows[0].horoscope_data === 'string')
      ? JSON.parse(r.rows[0].horoscope_data || '{}')
      : (r.rows[0].horoscope_data || {});
    if (!hd.quantum_data || !hd.aura_analysis) return res.status(404).json({ error: 'No quantum/aura data yet' });
    const cf = (typeof r.rows[0].custom_fields === 'string')
      ? JSON.parse(r.rows[0].custom_fields || '{}')
      : (r.rows[0].custom_fields || {});

    const buffer = await buildQuantumDoc({
      customerName:        cf.customer_name || '',
      quantumData:         hd.quantum_data,
      auraAnalysis:        hd.aura_analysis,
      quantumReading:      hd.quantum_reading      || null,
      quantumSectionsData: hd.quantum_sections_data || null,
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="quantum-${orderId}.docx"`);
    res.send(buffer);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * GET /api/plugins/horoscope/download-quantum-pdf/:orderId — stream standalone Quantum+Aura PDF.
 */
async function downloadQuantumPdf(req, res) {
  const { orderId } = req.params;
  try {
    const r = await db.pgQuery(
      'SELECT phone_number, custom_fields, horoscope_data FROM orders WHERE order_id=$1', [orderId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found' });
    const hd = (typeof r.rows[0].horoscope_data === 'string')
      ? JSON.parse(r.rows[0].horoscope_data || '{}')
      : (r.rows[0].horoscope_data || {});
    if (!hd.quantum_data || !hd.aura_analysis) return res.status(404).json({ error: 'No quantum/aura data yet' });

    const cf = (typeof r.rows[0].custom_fields === 'string')
      ? JSON.parse(r.rows[0].custom_fields || '{}')
      : (r.rows[0].custom_fields || {});

    const docxBuffer = await buildQuantumDoc({
      customerName:        cf.customer_name || '',
      quantumData:         hd.quantum_data,
      auraAnalysis:        hd.aura_analysis,
      quantumReading:      hd.quantum_reading      || null,
      quantumSectionsData: hd.quantum_sections_data || null,
    });

    const uid  = `${orderId}-qc-${Date.now()}`;
    const tmpHome = path.join(os.tmpdir(), `lo-home-${uid}`);
    const tmpDocx = path.join(os.tmpdir(), `qc-${uid}.docx`);
    const tmpPdf  = path.join(os.tmpdir(), `qc-${uid}.pdf`);

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

    fs.writeFileSync(tmpDocx, docxBuffer);
    await convertDocxToPdf(tmpDocx, os.tmpdir(), tmpHome, fontDirs[0]);

    const { PDFDocument } = require('pdf-lib');
    const rawPdf = fs.readFileSync(tmpPdf);
    const pdfDoc = await PDFDocument.load(rawPdf);
    pdfDoc.setTitle('ක්වොන්ටම් ශක්ති කේතය');
    pdfDoc.setAuthor('පුරාණ ජෝතිර්වේදය හදහන් සේවය');
    pdfDoc.setCreator('පුරාණ ජෝතිර්වේදය');
    pdfDoc.setProducer('පුරාණ ජෝතිර්වේදය');
    pdfDoc.setSubject('ක්වොන්ටම් ශක්ති කේතය');
    pdfDoc.setKeywords([]);
    const buffer = Buffer.from(await pdfDoc.save());
    fs.rm(tmpHome, { recursive: true, force: true }, () => {});
    fs.unlink(tmpDocx, () => {});
    fs.unlink(tmpPdf, () => {});

    const phone    = (r.rows[0].phone_number || orderId).replace(/\D/g, '');
    const parsed   = parseSinhalaDate(cf.birth_date || '');
    const birthday = parsed
      ? `${parsed.year}${String(parsed.month).padStart(2,'0')}${String(parsed.day).padStart(2,'0')}`
      : (cf.birth_date || 'unknown').replace(/[^0-9]/g, '').slice(0, 8);
    const filename = `${phone}-${birthday}-aura.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

async function regenerateQuantumSections(req, res) {
  const { orderId } = req.params;
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  try {
    const r = await db.pgQuery(
      'SELECT horoscope_data FROM orders WHERE order_id=$1', [orderId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found' });

    const hd = (typeof r.rows[0].horoscope_data === 'string')
      ? JSON.parse(r.rows[0].horoscope_data || '{}')
      : (r.rows[0].horoscope_data || {});

    if (!hd.quantum_data)   return res.status(400).json({ error: 'No quantum data. Generate horoscope with quantum first.' });
    if (!hd.aura_analysis)  return res.status(400).json({ error: 'No aura analysis found.' });

    // Mark quantum as generating so the drawer can reflect this even if reopened
    await db.pgQuery(
      `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}'), '{quantum_generating}', 'true'::jsonb) WHERE order_id=$1`,
      [orderId]
    );

    res.json({ ok: true, generating: true });

    const config = await db.getPluginConfig(clientId, 'horoscope_reading');
    const quantumSystemPrompt = config.quantum_system_prompt || '';
    const hasConfigSections = Array.isArray(config.quantum_sections) && config.quantum_sections.length > 0;

    console.log('[REGEN-QUANTUM] Starting for order', orderId);
    console.log('[REGEN-QUANTUM] config.quantum_system_prompt:', quantumSystemPrompt ? `(${quantumSystemPrompt.length} chars) "${quantumSystemPrompt.slice(0, 120)}${quantumSystemPrompt.length > 120 ? '...' : ''}"` : '(empty — will use built-in default)');

    let reading = null;
    let sectionsData = null;

    if (hasConfigSections) {
      sectionsData = await generateQuantumSections(
        hd.quantum_data, hd.aura_analysis,
        config.quantum_sections, undefined,
        quantumSystemPrompt,
        hd.chart_data?.vimshottari_dasha || null
      );
    } else {
      reading = await generateQuantumReading(
        hd.quantum_data, hd.aura_analysis, undefined, quantumSystemPrompt
      );
    }

    const updated = {
      ...hd,
      ...(reading      && { quantum_reading: reading }),
      ...(sectionsData && { quantum_sections_data: sectionsData }),
    };
    delete updated.quantum_generating;
    await db.pgQuery(
      'UPDATE orders SET horoscope_data=$1 WHERE order_id=$2',
      [JSON.stringify(updated), orderId]
    );
    console.log('[REGEN-QUANTUM] Done for order', orderId);
  } catch (e) {
    console.error('[REGEN-QUANTUM] Error:', e.message);
    // Clear the generating flag even on error so the drawer doesn't get stuck
    await db.pgQuery(
      `UPDATE orders SET horoscope_data = horoscope_data - 'quantum_generating' WHERE order_id=$1`,
      [orderId]
    ).catch(() => {});
  }
}

async function regenerateHoroscopeSectionHandler(req, res) {
  const { orderId } = req.params;
  const { label } = req.body;
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  if (!label?.trim()) return res.status(400).json({ error: 'label required' });

  try {
    const r = await db.pgQuery(
      'SELECT horoscope_data FROM orders WHERE order_id=$1', [orderId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found' });
    const hd = (typeof r.rows[0].horoscope_data === 'string')
      ? JSON.parse(r.rows[0].horoscope_data || '{}')
      : (r.rows[0].horoscope_data || {});

    if (!hd.chart_data) return res.status(400).json({ error: 'No chart data found.' });

    const config = await db.getPluginConfig(clientId, 'horoscope_reading');
    const systemPrompt = config.system_prompt || '';

    // Find guide for this section from config
    const sectionDef = Array.isArray(config.horoscope_sections)
      ? config.horoscope_sections.find(s => s.label === label.trim())
      : null;
    const sectionGuide = sectionDef?.guide || config.section_guides?.[label.trim()] || '';

    console.log(`[REGEN-HORO-SECTION] order=${orderId} label="${label}"`);

    const newContent = await regenerateHoroscopeSection({
      chartData:     hd.chart_data,
      systemPrompt,
      sectionKey:    label.trim(),
      sectionGuide,
      specialAnswers: hd.special_answers || [],
    });

    await db.pgQuery(
      `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}'), '{sections,${label.trim()}}', $1::jsonb) WHERE order_id=$2`,
      [JSON.stringify(newContent), orderId]
    );

    console.log(`[REGEN-HORO-SECTION] Done order=${orderId} label="${label}"`);
    res.json({ ok: true, label: label.trim(), content: newContent });
  } catch (e) {
    console.error('[REGEN-HORO-SECTION] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

async function regenerateQuantumSection(req, res) {
  const { orderId } = req.params;
  const { label } = req.body;
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  if (!label?.trim()) return res.status(400).json({ error: 'label required' });

  try {
    const r = await db.pgQuery(
      'SELECT horoscope_data FROM orders WHERE order_id=$1', [orderId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found' });
    const hd = (typeof r.rows[0].horoscope_data === 'string')
      ? JSON.parse(r.rows[0].horoscope_data || '{}')
      : (r.rows[0].horoscope_data || {});

    if (!hd.quantum_data)  return res.status(400).json({ error: 'No quantum data found.' });
    if (!hd.aura_analysis) return res.status(400).json({ error: 'No aura analysis found.' });

    const config = await db.getPluginConfig(clientId, 'horoscope_reading');
    const sectionDef = Array.isArray(config.quantum_sections)
      ? config.quantum_sections.find(s => s.label === label.trim())
      : null;

    if (!sectionDef) return res.status(404).json({ error: `Section "${label}" not found in config.` });

    console.log(`[REGEN-SECTION] order=${orderId} label="${label}"`);

    const results = await generateQuantumSections(
      hd.quantum_data,
      hd.aura_analysis,
      [sectionDef],
      undefined,
      config.quantum_system_prompt || '',
      hd.chart_data?.vimshottari_dasha || null
    );

    const newContent = results[0]?.content || '';

    // Update only this section in quantum_sections_data
    const existing = Array.isArray(hd.quantum_sections_data) ? hd.quantum_sections_data : [];
    const idx = existing.findIndex(s => s.label === label.trim());
    let updated;
    if (idx >= 0) {
      updated = existing.map((s, i) => i === idx ? { ...s, content: newContent } : s);
    } else {
      updated = [...existing, { label: label.trim(), content: newContent }];
    }

    await db.pgQuery(
      `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}'), '{quantum_sections_data}', $1::jsonb) WHERE order_id=$2`,
      [JSON.stringify(updated), orderId]
    );

    console.log(`[REGEN-SECTION] Done order=${orderId} label="${label}"`);
    res.json({ ok: true, label: label.trim(), content: newContent });
  } catch (e) {
    console.error('[REGEN-SECTION] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

async function saveWaMessageHandler(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { orderId } = req.params;
  const { wa_message } = req.body;
  if (typeof wa_message !== 'string') return res.status(400).json({ error: 'wa_message required' });

  try {
    await db.pgQuery(
      `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}'), '{wa_message}', $1::jsonb) WHERE order_id=$2`,
      [JSON.stringify(wa_message), orderId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[WA-MESSAGE-SAVE] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

async function generateWaMessageHandler(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { orderId } = req.params;

  try {
    const r = await db.pgQuery('SELECT horoscope_data FROM orders WHERE order_id=$1', [orderId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found' });
    const hd = (typeof r.rows[0].horoscope_data === 'string')
      ? JSON.parse(r.rows[0].horoscope_data || '{}')
      : (r.rows[0].horoscope_data || {});

    const config = await db.getPluginConfig(clientId, 'horoscope_reading');
    const waMessagePrompt = config.wa_message_prompt || '';
    if (!waMessagePrompt.trim()) return res.status(400).json({ error: 'wa_message_prompt not configured in plugin settings' });

    const waMessage = await generateWaMessage(orderId, hd, waMessagePrompt);
    res.json({ wa_message: waMessage });
  } catch (e) {
    console.error('[WA-MESSAGE] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

const { genAI } = require('../services/gemini');

/**
 * POST /api/plugins/horoscope/ai-prepare/:orderId
 * Uses Gemini to read the customer's chat + order details and return:
 *  - birth_time_24h  : normalized "HH:MM"
 *  - birth_place_query : best Nominatim search string
 *  - geocoded place   : { lat, lng, name } from Nominatim
 *  - special_questions : [{question, sections}] crafted to maximise horoscope section quality
 */
async function aiPrepareHoroscope(req, res) {
  const clientId = resolveClientId(req);
  const { orderId } = req.params;

  try {
    // 1. Fetch order
    const orderRes = await db.pgQuery(
      'SELECT * FROM orders WHERE order_id=$1',
      [orderId]
    );
    if (!orderRes.rows.length) return res.status(404).json({ error: 'Order not found' });
    const order = orderRes.rows[0];
    const cf = (typeof order.custom_fields === 'string')
      ? JSON.parse(order.custom_fields || '{}')
      : (order.custom_fields || {});

    // 2. Fetch chat messages
    const messages = await db.getMessagesByPhone(order.phone_number, clientId);
    const chatLog = messages.map(m =>
      `[${m.sender_type === 'user' ? 'Customer' : 'Agent'}]: ${m.message_text || ''}`
    ).filter(l => l.length > 12).join('\n');

    // 3. Call Gemini
    const prompt = `You are an expert Vedic astrology assistant and Sinhala language expert helping prepare a horoscope reading request.

## Order Details
- Customer name: ${cf.customer_name || cf.name || ''}
- Birth date (raw): ${cf.birth_date || ''}
- Birth time (raw): ${cf.birth_time || ''}
- Birth place (raw): ${cf.birth_place || ''}
- Lagna (if known): ${cf.lagnaya || cf.lagna || ''}
- Problem / concern: ${cf.problems || cf.summary || ''}
- Items ordered: ${JSON.stringify(cf.items || [])}

## Full Customer Chat Conversation
${chatLog || '(no messages found)'}

## Your Task — return the exact JSON schema below, nothing else.

### birth_date_iso
Normalize the raw birth date to exactly "YYYY-MM-DD" format (e.g. "1990-03-15").
Sinhala month names: ජනවාරි=01 පෙබරවාරි=02 මාර්තු=03 අප්‍රේල්=04 මැයි=05 ජූනි=06 ජූලි=07 අගෝස්තු=08 සැප්තැම්බර්=09 ඔක්තෝබර්=10 නොවැම්බර්=11 දෙසැම්බර්=12
Return null if genuinely unknown.

### birth_time_24h
Normalize the raw birth time to exactly "HH:MM" 24-hour format (e.g. "21:00" for 9 PM, "06:30" for 6:30 AM).
Sinhala markers: "ප.ව" or "සවස" or "රාත්‍රී" or "රාත්රී" or "දහවල්" = PM. "පෙ.ව" or "උදෑසන" or "උදේ" = AM.
Midnight = "00:00". Noon = "12:00". Return null if genuinely unknown.

### birth_place_query
The best English search string for OpenStreetMap Nominatim to pinpoint this exact location.
Translate Sinhala place names to English. Always append ", Sri Lanka" unless clearly a foreign country.
If it is a hospital or institution, use the nearest town (e.g. "Polgahawela, Sri Lanka" not "Polgahawela Hospital, Sri Lanka" — Nominatim finds towns better).

### special_questions
Read the customer's chat conversation carefully. Identify every specific concern, problem, fear, or question the customer raised — not just the headline topic.
Generate 2–5 questions that will be injected as context into Gemini when it writes each horoscope section.
Each question MUST:
- Be written as a detailed astrological analysis instruction, not a simple topic label
- Reference the customer's exact words or situation
- Name the relevant houses (1st–12th), grahas (Sun/Moon/Mars/Mercury/Jupiter/Venus/Saturn/Rahu/Ketu), and yogas to investigate
- End with a request for specific Dasha/Antardasha timing predictions
- Use English (the horoscope AI reads English prompts)

GOOD example: "Customer has been working in Dubai for 3 years but money does not stay — income arrives but disappears immediately. Examine the 2nd house lord (dhana sthana), 11th house lord (labha sthana), any malefic aspects on Jupiter and the Moon, and presence of Kemadruma yoga or Daridra yoga. Identify the specific Dasha–Antardasha period when financial accumulation and stability will begin."

BAD example: "money problems"

The "sections" array for each question must list the most relevant section keys from: marriage_life, financial_life, career_job, health, foreign_life, children_education, enemies_obstacles, general_future`;

    const geminiModel = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.2,
        topP: 0.9,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            birth_date_iso:    { type: 'string', nullable: true },
            birth_time_24h:    { type: 'string', nullable: true },
            birth_place_query: { type: 'string' },
            special_questions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  question: { type: 'string' },
                  sections: { type: 'array', items: { type: 'string' } },
                },
                required: ['question', 'sections'],
              },
            },
          },
          required: ['birth_date_iso', 'birth_time_24h', 'birth_place_query', 'special_questions'],
        },
      },
    });
    const result = await geminiModel.generateContent(prompt);
    const raw = result.response.text().trim();
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return res.status(500).json({ error: 'Gemini returned invalid JSON', raw }); }

    // 4. Geocode via Nominatim
    let geocoded = null;
    if (parsed.birth_place_query) {
      try {
        const axios = require('axios');
        const geoRes = await axios.get(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(parsed.birth_place_query)}&format=json&limit=1`,
          { headers: { 'User-Agent': 'pj-crm/1.0' } }
        );
        if (geoRes.data?.[0]) {
          const g = geoRes.data[0];
          geocoded = { lat: parseFloat(g.lat), lng: parseFloat(g.lon), name: g.display_name };
        }
      } catch { /* geocode failure is non-fatal */ }
    }

    res.json({
      birth_date_iso:    parsed.birth_date_iso || null,
      birth_time_24h:    parsed.birth_time_24h || null,
      birth_place_query: parsed.birth_place_query || null,
      geocoded,
      special_questions: Array.isArray(parsed.special_questions) ? parsed.special_questions : [],
    });
  } catch (e) {
    console.error('[AI-PREPARE]', e.message);
    res.status(500).json({ error: e.message });
  }
}

const LAGNA_SINHALA = {
  Aries: 'මේෂ', Taurus: 'වෘෂභ', Gemini: 'මිථුන', Cancer: 'කටක',
  Leo: 'සිංහ', Virgo: 'කන්නියා', Libra: 'තුලා', Scorpio: 'වෘශ්චික',
  Sagittarius: 'ධනු', Capricorn: 'මකර', Aquarius: 'කුම්භ', Pisces: 'මීන',
};

/**
 * POST /api/plugins/horoscope/fetch-chart — call freeastroapi and save chart_data for an order.
 * Returns ascendant sign so the admin can verify lagnaya before generating the full reading.
 */
async function fetchChartData(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  const { order_id, lat, lng, birth_place_name, birth_overrides } = req.body;
  if (!order_id || lat == null || lng == null) {
    return res.status(400).json({ error: 'order_id, lat, lng required' });
  }

  const overrides = birth_overrides || {};
  const dateInfo  = parseSinhalaDate(overrides.birth_date || '');
  const timeInfo  = parseSinhalaTime(overrides.birth_time || '');
  if (!dateInfo) return res.status(400).json({ error: `Cannot parse birth_date: "${overrides.birth_date}"` });
  if (!timeInfo) return res.status(400).json({ error: `Cannot parse birth_time: "${overrides.birth_time}"` });

  const { year, month, day } = dateInfo;
  const { hour, minute }     = timeInfo;

  try {
    const config = await db.getPluginConfig(clientId, 'horoscope_reading');
    const apiKey = config.api_key || process.env.FREEASTRO_API_KEY;

    const astroPayload = {
      year, month, day, hour, minute,
      lat: parseFloat(lat), lng: parseFloat(lng),
      tz_str: 'Asia/Colombo',
      ayanamsha: 'lahiri',
      house_system: 'whole_sign',
      node_type: 'mean',
      vargas: [1, 9, 7],
      dasha_levels: 2,
    };

    const axios = require('axios');
    const astroResp = await axios.post(
      'https://api.freeastroapi.com/api/v1/vedic/calculate',
      astroPayload,
      { headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' } }
    );
    const chartData = astroResp.data;

    await db.pgQuery(
      `UPDATE orders SET horoscope_data = COALESCE(horoscope_data,'{}') ||
        jsonb_build_object(
          'chart_data', $1::jsonb,
          'lat', $2::float,
          'lng', $3::float,
          'birth_place_name', $4::text
        )
       WHERE order_id=$5`,
      [JSON.stringify(chartData), parseFloat(lat), parseFloat(lng), birth_place_name || '', order_id]
    );

    const sign = chartData.ascendant?.sign || null;
    res.json({ ok: true, sign, sign_si: LAGNA_SINHALA[sign] || sign });
  } catch (e) {
    console.error('[FETCH-CHART]', e.message);
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  getPluginConfig, updatePluginConfig, getPluginCustomerData, generateAstroChart,
  analyzeAuraImage,
  aiPrepareHoroscope,
  fetchChartData,
  generateHoroscopeReading, updateHoroscopeSections, updateQuantumSections,
  regenerateQuantumSections, regenerateQuantumSection, regenerateHoroscopeSectionHandler,
  saveWaMessageHandler,
  generateWaMessageHandler,
  downloadQuantumDocx,
  downloadHoroscope, downloadHoroscopePdf, downloadQuantumPdf,
};
