/**
 * @module controllers/embeddedSignup.controller
 * @description WhatsApp Embedded Signup onboarding.
 *
 * The browser runs Meta's Embedded Signup popup (Facebook Login for Business),
 * which returns a short-lived OAuth `code` plus the `waba_id` / `phone_number_id`
 * the client just set up. This controller exchanges that code server-side (the
 * app secret never touches the browser), subscribes our app to the client's
 * WABA so its messages reach our single `/webhook`, and reports back the phone
 * numbers on the WABA so the operator can finish creating the client row.
 *
 * Requires env: META_APP_ID, META_APP_SECRET, META_ES_CONFIG_ID.
 * Onboarding this way assumes our Business is verified and the app has advanced
 * access to whatsapp_business_management / whatsapp_business_messaging.
 */

'use strict';

const axios = require('axios');
const {
  META_APP_ID, META_APP_SECRET, META_GRAPH_VERSION, META_ES_CONFIG_ID,
} = require('../config/env');

const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

/** GET /admin/embedded-signup/config — public (to the CRM) launch parameters. */
function getConfig(_req, res) {
  if (!META_APP_ID || !META_ES_CONFIG_ID) {
    return res.status(503).json({
      error: 'Embedded Signup is not configured. Set META_APP_ID, META_APP_SECRET and META_ES_CONFIG_ID.',
    });
  }
  res.json({
    appId: META_APP_ID,
    configId: META_ES_CONFIG_ID,
    graphVersion: META_GRAPH_VERSION,
  });
}

/**
 * Exchange the Embedded Signup auth code for a business access token.
 * @param {string} code
 * @returns {Promise<string>}
 */
async function exchangeCode(code) {
  const { data } = await axios.get(`${GRAPH}/oauth/access_token`, {
    params: {
      client_id: META_APP_ID,
      client_secret: META_APP_SECRET,
      code,
    },
    timeout: 15000,
  });
  if (!data.access_token) throw new Error('Meta did not return an access token');
  return data.access_token;
}

/**
 * POST /admin/embedded-signup
 * Body: { code, waba_id, phone_number_id? }
 * Exchanges the code, subscribes our app to the WABA, and returns the WABA's
 * phone numbers so the caller can create the client row.
 */
async function complete(req, res) {
  const { code, waba_id, phone_number_id } = req.body || {};
  if (!META_APP_ID || !META_APP_SECRET || !META_ES_CONFIG_ID) {
    return res.status(503).json({ error: 'Embedded Signup is not configured on the server.' });
  }
  if (!code || !waba_id) {
    return res.status(400).json({ error: 'code and waba_id are required' });
  }

  try {
    const token = await exchangeCode(code);

    // Subscribe our app to the client's WABA so inbound messages hit /webhook.
    await axios.post(`${GRAPH}/${waba_id}/subscribed_apps`, null, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    });

    // List the numbers on the WABA (verified_name / display number help the
    // operator confirm they are wiring up the right one).
    let phone_numbers = [];
    try {
      const { data } = await axios.get(`${GRAPH}/${waba_id}/phone_numbers`, {
        params: { fields: 'id,display_phone_number,verified_name,code_verification_status,quality_rating' },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000,
      });
      phone_numbers = data.data || [];
    } catch (e) {
      console.warn('[ES] could not list phone numbers:', e.response?.data?.error?.message || e.message);
    }

    const resolvedPhoneId = phone_number_id
      || (phone_numbers[0] && phone_numbers[0].id)
      || null;

    console.log(`[ES] onboarded waba=${waba_id} phone=${resolvedPhoneId} numbers=${phone_numbers.length}`);
    res.json({
      ok: true,
      waba_id,
      phone_number_id: resolvedPhoneId,
      phone_numbers,
      subscribed: true,
    });
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    console.error('[ES] onboarding failed:', detail);
    res.status(502).json({ error: `Embedded Signup failed: ${detail}` });
  }
}

module.exports = { getConfig, complete };
