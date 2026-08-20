'use strict';

/**
 * @module services/marriage
 * @description Marriage (විවාහ) reading generation service.
 * Runs the same pipeline as the horoscope reading — freeastroapi chart data as the
 * Gemini system instruction, then one Gemini call per configurable section — but with
 * its own system prompt, its own section list and its own Word/PDF document.
 *
 * Config lives under the existing `horoscope_reading` plugin:
 *   marriage_system_prompt  — Gemini system instruction (blank → built-in default)
 *   marriage_sections       — [{ label, guide }]        (blank → no sections generated)
 *   marriage_special_note   — closing note appended to the document
 *   marriage_wa_prompt      — system prompt for the WhatsApp summary message
 *
 * Results are saved on orders.horoscope_data:
 *   marriage_sections_data  — [{ label, content }]
 *   marriage_wa_message     — string
 */

const db        = require('../db');
const { getGenAI } = require('./clientKeys');
const { sendRequired } = require('./aiRetry');
const { buildSectionsDoc } = require('./horoscope');
const { todayContextBlock } = require('./dateContext');





function buildMarriageSectionPrompt(label, guide, fixedInstructions) {
  const guideText = guide
    ? `**මෙම අංශය සඳහා අනිවාර්යයෙන්ම ඇතුළත් කළ යුතු කරුණු:** ${guide}\n`
    : '';
  return (
    `ඔබ දැන් විශ්ලේෂණය කළ යුත්තේ [${label}] යන අංශය පිළිබඳව පමණයි. වෙනත් අංශ ගැන මෙහිදී විස්තර නොකරන්න. ` +
    `වෘත්තීය මට්ටමේ, ගලාගෙන යන ශාස්ත්‍රීය විග්‍රහයක් ලබා දෙන්න.\n\n` +
    `${guideText}\n` +
    (fixedInstructions || '')
  );
}

/**
 * Resolve the effective marriage config for a client (falling back to built-in defaults).
 */
function resolveMarriageConfig(config) {
  // Client-owned editorial content only: no built-in persona or section list.
  const sections = (Array.isArray(config.marriage_sections) && config.marriage_sections.length > 0)
    ? config.marriage_sections.filter(s => s && s.label)
    : [];
  return {
    sections,
    systemPrompt:      (config.marriage_system_prompt || '').trim(),
    specialNote:       (config.marriage_special_note || '').trim(),
    reportTitle:       (config.marriage_report_title || '').trim(),
    fixedInstructions: (config.marriage_fixed_instructions || '').trim(),
  };
}

/**
 * Build the Gemini model for a marriage run. The chart data is constant across every
 * section, so it belongs in the systemInstruction and the model is built once per run.
 */
async function buildMarriageModel({ clientId, chartData, systemPrompt }) {
  const chartDataJson  = JSON.stringify(chartData, null, 2) + todayContextBlock();
  const sysInstruction = systemPrompt + '\n\nමෙම කේන්ද්‍ර දත්ත සම්පූර්ණ වාර්තාව සඳහා පදනම වේ:\n\n' + chartDataJson;
  return (await getGenAI(clientId)).getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.4, topP: 0.8, topK: 40 },
    systemInstruction: sysInstruction,
  });
}

/**
 * Rebuild a chat history from already-saved sections, for the regenerate-one-section
 * path where no live session exists any more. The section being redone is excluded so
 * the model rewrites it rather than repeating itself.
 */
function historyFromSections(sectionsData, excludeLabel) {
  return (sectionsData || [])
    .filter(s => s && s.label && s.content && s.label !== excludeLabel)
    .flatMap(s => [
      { role: 'user',  parts: [{ text: `මාතෘකාව: [${s.label}]` }] },
      { role: 'model', parts: [{ text: s.content }] },
    ]);
}

/**
 * Generate one marriage section from saved chart data.
 * Pass an existing `chat` to keep the run's shared session (and its accumulated history);
 * omit it and a one-off session is built instead.
 * @returns {Promise<string>} the section text
 */
async function generateMarriageSectionText({ clientId, chartData, systemPrompt, label, guide, chat, history, fixedInstructions }) {
  const prompt = buildMarriageSectionPrompt(label, guide, fixedInstructions);

  console.log(`[MARRIAGE] ── REQUEST: "${label}"`);
  console.log('[MARRIAGE] userPrompt:\n' + prompt);

  const activeChat = chat
    || (await buildMarriageModel({ clientId, chartData, systemPrompt })).startChat({ history: history || [] });
  const text = await sendRequired(activeChat, prompt, label);
  const usage  = result.response.usageMetadata;
  console.log(`[MARRIAGE] ── RESPONSE: "${label}" tokens in=${usage?.promptTokenCount ?? '?'} out=${usage?.candidatesTokenCount ?? '?'} chars=${text.length}`);
  return text;
}

/**
 * Generate every configured marriage section for an order and save the result.
 * Requires chart_data to already exist on the order (fetched by the horoscope flow).
 *
 * @param {string} clientId
 * @param {string} orderId
 * @returns {Promise<Array<{label: string, content: string}>>}
 */
async function generateMarriageReading(clientId, orderId) {
  const r = await db.pgQuery('SELECT horoscope_data FROM orders WHERE order_id=$1', [orderId]);
  if (!r.rows.length) throw new Error('Order not found');

  const hd = (typeof r.rows[0].horoscope_data === 'string')
    ? JSON.parse(r.rows[0].horoscope_data || '{}')
    : (r.rows[0].horoscope_data || {});

  if (!hd.chart_data) {
    throw new Error('No chart data found for this order. Generate the horoscope (or fetch the chart) first.');
  }

  const config = await db.getPluginConfig(clientId, 'horoscope_reading');
  const { sections, systemPrompt, fixedInstructions } = resolveMarriageConfig(config);
  if (!systemPrompt) {
    const err = new Error('No marriage system prompt configured for this client. Set it in Plugins > Horoscope Reading before generating.');
    err.statusCode = 422;
    throw err;
  }
  if (!sections.length) {
    const err = new Error('No marriage sections configured for this client. Define them in Plugins > Horoscope Reading before generating.');
    err.statusCode = 422;
    throw err;
  }

  console.log(`[MARRIAGE] Generating ${sections.length} sections for order ${orderId}`);
  console.log(`[MARRIAGE] systemPrompt (${systemPrompt.length} chars):\n` + systemPrompt);

  // ONE session for the whole run — every section sees what came before it, which is what
  // makes rule 3 of MARRIAGE_FIXED_INSTRUCTIONS ("do not reuse earlier wording") effective.
  // Scoped to this call: created per order, discarded when the run ends.
  const chat = (await buildMarriageModel({ clientId, chartData: hd.chart_data, systemPrompt })).startChat({});

  const out = [];
  for (const sec of sections) {
    const content = await generateMarriageSectionText({
      clientId,
      fixedInstructions,
      label: sec.label,
      guide: sec.guide || '',
      chat,
    });
    out.push({ label: sec.label, content });
  }

  const updated = {
    ...hd,
    marriage_sections_data: out,
    marriage_generated_at:  new Date().toISOString(),
  };
  delete updated.marriage_generating;
  delete updated.marriage_error;

  await db.pgQuery('UPDATE orders SET horoscope_data=$1 WHERE order_id=$2', [JSON.stringify(updated), orderId]);
  console.log(`[MARRIAGE] Saved ${out.length} sections for order ${orderId}`);

  // Auto-generate the WhatsApp message if a prompt is configured
  if (config.marriage_wa_prompt && config.marriage_wa_prompt.trim()) {
    try {
      await generateMarriageWaMessage(clientId, orderId, out, config.marriage_wa_prompt);
      console.log('[MARRIAGE] WA message generated for', orderId);
    } catch (e) {
      console.error('[MARRIAGE] WA message generation failed (non-fatal):', e.message);
    }
  }

  return out;
}

/**
 * Generate (or regenerate) the WhatsApp summary message for a marriage reading.
 * Saves to horoscope_data.marriage_wa_message.
 */
async function generateMarriageWaMessage(clientId, orderId, sectionsData, waPrompt) {
  const contextText = ['=== විවාහ පලාපල වාර්තාව ===']
    .concat((sectionsData || []).map(s => `\n--- ${s.label} ---\n${s.content}`))
    .join('\n');

  const model = (await getGenAI(clientId)).getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.7, topP: 0.9, topK: 40 },
    systemInstruction: waPrompt,
  });
  const chat = model.startChat({});
  const message = await sendRequired(chat, contextText, 'marriage WhatsApp message');
  console.log(`[MARRIAGE-WA] order=${orderId} chars=${message.length}`);

  await db.pgQuery(
    `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}'), '{marriage_wa_message}', $1::jsonb) WHERE order_id=$2`,
    [JSON.stringify(message), orderId]
  );
  return message;
}

/**
 * Build the marriage Word document.
 */
async function buildMarriageDoc({ customerName, sections, specialNote, birthDate, birthTime, sectionOrder, brand, reportTitle }) {
  // Order by plugin config if provided; saved data may predate a reorder.
  let ordered = Array.isArray(sections) ? sections.map(s => ({ ...s })) : [];
  if (Array.isArray(sectionOrder) && sectionOrder.length > 0) {
    const byLabel  = Object.fromEntries(ordered.map(s => [s.label, s]));
    const sorted   = sectionOrder.map(o => byLabel[o.label]).filter(Boolean);
    const inConfig = new Set(sectionOrder.map(o => o.label));
    ordered.filter(s => !inConfig.has(s.label)).forEach(s => sorted.push(s));
    ordered = sorted;
  }

  return await buildSectionsDoc({
    brand,
    customerName,
    reportTitle: reportTitle || '',
    sections:    ordered,
    specialNote,
    birthDate,
    birthTime,
  });
}

module.exports = {
  generateMarriageReading,
  generateMarriageSectionText,
  historyFromSections,
  generateMarriageWaMessage,
  buildMarriageDoc,
  resolveMarriageConfig,
};
