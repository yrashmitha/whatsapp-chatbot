'use strict';

const crypto = require('crypto');
const axios  = require('axios');
const db     = require('../db');

function hashPhone(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  return crypto.createHash('sha256').update(digits).digest('hex');
}

async function _getConfig(clientId) {
  if (!db.IS_PG) return null;
  const addonCheck = await db.pgQuery(
    `SELECT enabled FROM client_addons WHERE client_id=$1 AND addon_id='meta_conversions' AND enabled=TRUE`,
    [clientId]
  );
  if (!addonCheck.rows.length) return null;
  const config = await db.getPluginConfig(clientId, 'meta_conversions');
  const pixelId     = config.pixel_id;
  const accessToken = config.api_key;
  if (!pixelId || !accessToken) return null;
  return {
    pixelId,
    accessToken,
    adAccountId: config.ad_account_id || '',
    audienceId:  config.audience_id   || '',
  };
}

/**
 * Fire a Meta Conversions API event for a client's customer.
 * Silent no-op if the addon isn't enabled or config is missing.
 */
async function fireCAPIEvent(clientId, eventName, phone, customData = {}) {
  if (!clientId || !phone) return;
  try {
    const cfg = await _getConfig(clientId);
    if (!cfg) return;

    const payload = {
      data: [{
        event_name:    eventName,
        event_time:    Math.floor(Date.now() / 1000),
        action_source: 'other',
        user_data:     { ph: [hashPhone(phone)] },
        custom_data:   customData,
      }],
      access_token: cfg.accessToken,
    };

    const r = await axios.post(
      `https://graph.facebook.com/v18.0/${cfg.pixelId}/events`,
      payload,
      { headers: { 'Content-Type': 'application/json' } }
    );
    console.log(`[META-CAPI] ${eventName} sent for ${phone}: events_received=${r.data.events_received}`);
  } catch (e) {
    console.warn(`[META-CAPI] Failed to send ${eventName} for ${phone}:`, e?.response?.data?.error?.message || e.message);
  }
}

/**
 * Sync all paid/delivered customer phones for a client to their Meta Custom Audience.
 * Queries statuses: payment_received, paid, delivered, done, complete.
 */
async function syncAudienceForClient(clientId) {
  const cfg = await _getConfig(clientId);
  if (!cfg) throw new Error('meta_conversions addon not enabled or missing pixel_id / api_key config');
  if (!cfg.audienceId) throw new Error('audience_id not configured — create an audience first');

  const r = await db.pgQuery(
    `SELECT DISTINCT phone_number FROM orders
     WHERE client_id=$1
       AND status IN ('payment_received','paid','delivered','done','complete')
       AND phone_number IS NOT NULL`,
    [clientId]
  );
  const phones = r.rows.map(row => row.phone_number);
  if (!phones.length) return { synced: 0, total: 0 };

  const BATCH_SIZE = 10000;
  let totalReceived = 0;
  for (let i = 0; i < phones.length; i += BATCH_SIZE) {
    const batch = phones.slice(i, i + BATCH_SIZE);
    const hashed = batch.map(hashPhone);
    const resp = await axios.post(
      `https://graph.facebook.com/v18.0/${cfg.audienceId}/users`,
      {
        payload: {
          schema: ['PHONE'],
          data:   hashed.map(h => [h]),
        },
        access_token: cfg.accessToken,
      },
      { headers: { 'Content-Type': 'application/json' } }
    );
    totalReceived += resp.data.num_received || batch.length;
    console.log(`[META-AUDIENCE] Batch ${Math.floor(i / BATCH_SIZE) + 1}: received=${resp.data.num_received} invalid=${resp.data.num_invalid_entries || 0}`);
  }

  return { synced: totalReceived, total: phones.length };
}

/**
 * Create a new Meta Custom Audience in the client's ad account and persist the ID to plugin config.
 */
async function createAudienceForClient(clientId, audienceName) {
  const config = await db.getPluginConfig(clientId, 'meta_conversions');
  const accessToken = config.api_key;
  let adAccountId   = config.ad_account_id || '';
  if (!accessToken)  throw new Error('api_key (Ads access token) not configured');
  if (!adAccountId)  throw new Error('ad_account_id not configured');
  if (!adAccountId.startsWith('act_')) adAccountId = `act_${adAccountId}`;

  const r = await axios.post(
    `https://graph.facebook.com/v18.0/${adAccountId}/customaudiences`,
    {
      name:                 audienceName || 'WhatsApp Bot Customers',
      description:          'Customers from WhatsApp chatbot — auto-synced',
      subtype:              'CUSTOM',
      customer_file_source: 'USER_PROVIDED_ONLY',
      access_token:         accessToken,
    },
    { headers: { 'Content-Type': 'application/json' } }
  );
  const audienceId = r.data.id;

  await db.upsertPluginConfig(clientId, 'meta_conversions', { ...config, audience_id: audienceId });
  console.log(`[META-AUDIENCE] Created audience "${audienceName}" id=${audienceId} for client ${clientId}`);
  return audienceId;
}

module.exports = { fireCAPIEvent, syncAudienceForClient, createAudienceForClient, hashPhone };
