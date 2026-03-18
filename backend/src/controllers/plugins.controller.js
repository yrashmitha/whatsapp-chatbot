/**
 * @module controllers/plugins.controller
 * @description Handlers for the plugin configuration API
 * (get/set config, get customer data, generate astro chart message).
 */

'use strict';

const db   = require('../db');
const { generateAstroMessage, DEFAULT_ASTRO_PROMPT } = require('../services/astro');
const { generateHoroscope, buildHoroscopeDoc, SECTIONS, parseSinhalaDate } = require('../services/horoscope');
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
  const { name, prompt, api_key, system_prompt, special_note } = req.body;
  try {
    const existing = await db.getPluginConfig(clientId, pluginId);
    const update = { ...existing };
    if (name !== undefined)          update.name          = name;
    if (prompt !== undefined)        update.prompt        = prompt;
    if (api_key !== undefined)       update.api_key       = api_key;
    if (system_prompt !== undefined) update.system_prompt = system_prompt;
    if (special_note !== undefined)  update.special_note  = special_note;
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
 * POST /api/plugins/horoscope/generate — generate full horoscope reading for an order.
 */
async function generateHoroscopeReading(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  const { order_id, lat, lng, birth_place_name, birth_overrides, override_astro, special_questions, package_type } = req.body;
  if (!order_id || lat == null || lng == null) {
    return res.status(400).json({ error: 'order_id, lat, lng required' });
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
    package_type === '1500'
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
      customerName: cf.customer_name || '',
      sections: hd.sections,
      specialAnswers: hd.special_answers || [],
      specialNote: config.special_note || '',
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

    const PDFDocument = require('pdfkit');
    const path = require('path');
    const fontRegular = path.join(__dirname, '../assets/fonts/NotoSansSinhala-Regular.ttf');
    const fontBold    = path.join(__dirname, '../assets/fonts/NotoSansSinhala-Bold.ttf');

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));

    doc.registerFont('SinhalaRegular', fontRegular);
    doc.registerFont('SinhalaBold', fontBold);

    // Title
    doc.font('SinhalaBold').fontSize(16).text(cf.customer_name || orderId, { align: 'center' });
    doc.moveDown(0.5);
    doc.font('SinhalaRegular').fontSize(10).fillColor('#666')
      .text(`Order: ${orderId}`, { align: 'center' });
    doc.moveDown(1);

    // Sections
    const SECTION_LABELS = [
      'පෞරුෂය','අධ්‍යාපනය','වෘත්තීය ජීවිතය','ප්‍රේමය සහ විවාහ',
      'දේපළ','සෞඛ්‍යය','දරු පල','ජීවන සාරාංශය','වර්තමාන දශාව','පිළියම්','VIP'
    ];
    Object.entries(hd.sections).forEach(([key, value], i) => {
      const label = SECTION_LABELS[i] || key;
      doc.font('SinhalaBold').fontSize(12).fillColor('#4f46e5').text(label);
      doc.moveDown(0.3);
      doc.font('SinhalaRegular').fontSize(11).fillColor('#1e293b').text(value || '', { align: 'justify', lineGap: 4 });
      doc.moveDown(1);
    });

    // Special questions
    if (hd.special_answers?.length) {
      (hd.special_answers).forEach((qa, i) => {
        doc.font('SinhalaBold').fontSize(12).fillColor('#4f46e5').text(`Q${i + 1}: ${qa.question || ''}`);
        doc.moveDown(0.3);
        doc.font('SinhalaRegular').fontSize(11).fillColor('#1e293b').text(qa.answer || '', { align: 'justify', lineGap: 4 });
        doc.moveDown(1);
      });
    }

    doc.end();
    await new Promise(resolve => doc.on('end', resolve));
    const buffer = Buffer.concat(chunks);

    const phone  = (r.rows[0].phone_number || orderId).replace(/\D/g, '');
    const last4  = phone.slice(-4) || '0000';
    const parsed = parseSinhalaDate(cf.birth_date || '');
    const birthday = parsed
      ? `${parsed.year}${String(parsed.month).padStart(2,'0')}${String(parsed.day).padStart(2,'0')}`
      : 'birthday';
    const filename = `horoscope-${last4}-${birthday}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = {
  getPluginConfig, updatePluginConfig, getPluginCustomerData, generateAstroChart,
  generateHoroscopeReading, updateHoroscopeSections, downloadHoroscope, downloadHoroscopePdf,
};
