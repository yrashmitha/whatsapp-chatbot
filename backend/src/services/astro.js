/**
 * @module services/astro
 * @description Vedic astrology chart generation service.
 * Calls freeastroapi to compute a birth chart, then passes the result to
 * Gemini to generate a personalised WhatsApp message for the customer.
 */

'use strict';

const axios = require('axios');
const db    = require('../db');
const { genAI } = require('./gemini');

/**
 * Default Gemini prompt template for the astro chart addon.
 * The literal `{chart_json}` is replaced at runtime with the API response.
 *
 * @type {string}
 */
const DEFAULT_ASTRO_PROMPT = `You are a warm astrology consultant. Based on the following vedic birth chart data, write a short, personalized WhatsApp message (2-3 sentences) to the customer to encourage them to complete their pending reading booking. Mention one specific planetary placement or nakshatra from their chart. Keep the tone friendly, spiritual, and encouraging. Do not mention prices. Reply only with the message text, no labels or preamble.\n\nChart data:\n{chart_json}`;

/**
 * Generate a personalised astrology message for a customer using their birth data.
 *
 * Workflow:
 * 1. Retrieve plugin config (prompt template, API key).
 * 2. Save birth_place_name to plugin_customer_data for future pre-fill.
 * 3. POST birth data to freeastroapi to obtain a vedic chart JSON.
 * 4. Inject chart JSON into the prompt template.
 * 5. Call Gemini to generate a warm WhatsApp message.
 *
 * @param {string} clientId - Multi-tenant client ID
 * @param {string} phone    - E.164 customer phone number
 * @param {Object} birthData
 * @param {number} birthData.year           - Birth year (1900–2100)
 * @param {number} birthData.month          - Birth month (1–12)
 * @param {number} birthData.day            - Birth day (1–31)
 * @param {number} birthData.hour           - Birth hour (0–23)
 * @param {number} birthData.minute         - Birth minute (0–59)
 * @param {number} birthData.lat            - Birth latitude
 * @param {number} birthData.lng            - Birth longitude
 * @param {string} [birthData.birth_place_name] - Human-readable birth place name
 * @param {string|null} apiKey              - freeastroapi key (overrides plugin config key)
 * @returns {Promise<string>} Generated WhatsApp message text
 */
async function generateAstroMessage(clientId, phone, birthData, apiKey) {
  const { year, month, day, hour, minute, lat, lng, birth_place_name } = birthData;

  const config = await db.getPluginConfig(clientId, 'astro_vedic_chart');

  const resolvedApiKey = apiKey || config.api_key || process.env.FREEASTRO_API_KEY;

  const astroPayload = {
    year, month, day, hour, minute,
    lat: parseFloat(lat), lng: parseFloat(lng),
    city: birth_place_name || '',
    tz_str: 'Asia/Colombo',
    ayanamsha: 'lahiri',
    house_system: 'whole_sign',
    node_type: 'mean',
  };
  console.log('[ASTRO] api_key source:', config.api_key ? 'plugin_config' : 'env');
  console.log('[ASTRO] freeastroapi request:', JSON.stringify(astroPayload));

  const astroResp = await axios.post(
    'https://api.freeastroapi.com/api/v1/vedic/chart',
    astroPayload,
    { headers: { 'x-api-key': resolvedApiKey, 'Content-Type': 'application/json' } }
  );
  const chartData = astroResp.data;

  // Save birth details + raw chart data for future use / pre-fill
  await db.upsertPluginCustomerData(clientId, phone, 'astro_vedic_chart', {
    birth_place_name: birth_place_name || null,
    lat, lng,
    chart_data: chartData,
  }).catch(e => console.warn('[ASTRO] failed to save chart data:', e.message));

  const promptTemplate = config.prompt || DEFAULT_ASTRO_PROMPT;
  const prompt = promptTemplate.replace('{chart_json}', JSON.stringify(chartData, null, 2));
  console.log('[ASTRO] Gemini prompt template:\n', promptTemplate);

  const pluginModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const geminiResult = await pluginModel.generateContent(prompt);
  const text = geminiResult.response.text();
  console.log('[ASTRO] Gemini response:', text);

  return text;
}

module.exports = { DEFAULT_ASTRO_PROMPT, generateAstroMessage };
