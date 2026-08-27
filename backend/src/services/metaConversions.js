'use strict';

const crypto = require('crypto');
const axios  = require('axios');
const db     = require('../db');
const { orderValue } = require('./salesCredit');

function hashStr(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function hashPhone(phone) {
  return hashStr((phone || '').replace(/\D/g, ''));
}

/**
 * Who Meta should match this event to.
 *
 * The hashed phone, and the click id when the conversation started from an ad.
 * The click id is the one that works: it names the exact click, so there is
 * nothing left to guess at.
 *
 * fn/ln used to be sent, split off the stored name by taking the first word as
 * the given name. On Sri Lankan names that word is almost always the ge-name -
 * in "kodagodage ranil yohan rupasinghe" the given name is the second - so the
 * field was usually wrong. And two thirds of the stored names are in Sinhala
 * script, which cannot hash-match a Facebook profile held in Latin. Fields that
 * never match add nothing and pull the Event Match Quality score down, so they
 * are not sent.
 */
function buildUserData(phone) {
  return { ph: [hashPhone(phone)] };
}

async function _getConfig(clientId) {
  if (!db.IS_PG) return null;
  const addonCheck = await db.pgQuery(
    `SELECT enabled FROM client_addons WHERE client_id=$1 AND addon_id='meta_conversions' AND enabled=TRUE`,
    [clientId]
  );
  if (!addonCheck.rows.length) return null;
  const config = await db.getPluginConfig(clientId, 'meta_conversions');
  if (!config.pixel_id || !config.api_key) return null;
  return {
    pixelId:     config.pixel_id,
    accessToken: config.api_key,
    adAccountId: config.ad_account_id || '',
    audienceId:  config.audience_id   || '',
    // Set only while verifying the setup. Events carrying a code land in Events
    // Manager under Test Events and are kept out of attribution and
    // optimisation, so a smoke test cannot teach the campaign about a sale that
    // never happened. Left in by accident it would quietly exclude every real
    // purchase, which is why fireCAPIEvent shouts about it on every send.
    testEventCode: config.test_event_code || '',
  };
}

async function _logEvent(clientId, eventName, phone, status, detail) {
  if (!db.IS_PG) return;
  const last4 = (phone || '').replace(/\D/g, '').slice(-4);
  db.pgQuery(
    `INSERT INTO meta_capi_log (client_id, event_name, phone_last4, status, detail) VALUES ($1,$2,$3,$4,$5)`,
    [clientId, eventName, last4, status, detail || null]
  ).catch(() => {});
}

/**
 * Fire a Meta Conversions API event. Looks up customer name automatically.
 * Silent no-op if the addon isn't enabled or config is missing.
 */
async function fireCAPIEvent(clientId, eventName, phone, customData = {}) {
  if (!clientId || !phone) return;
  try {
    const cfg = await _getConfig(clientId);
    if (!cfg) return;

    // The click that started this conversation, if it came from an ad. This is
    // what turns the event from "somebody bought" into "this ad produced a
    // customer", which is the only version Meta can optimise on.
    let ctwaClid = null;
    if (db.IS_PG) {
      const r = await db.pgQuery(
        `SELECT ctwa_clid FROM ad_referrals
          WHERE client_id=$1 AND phone_number=$2 AND ctwa_clid IS NOT NULL
          ORDER BY created_at DESC LIMIT 1`,
        [clientId, phone]
      ).catch(() => ({ rows: [] }));
      ctwaClid = r.rows[0]?.ctwa_clid || null;
    }

    // Meta will not accept a business_messaging conversion without both the
    // channel and the account that owns the conversation. Captured from the
    // webhook rather than configured, because no token of ours can read it.
    let wabaId = null;
    if (db.IS_PG) {
      const w = await db.pgQuery(
        'SELECT waba_id FROM client_configs WHERE client_id=$1', [clientId]
      ).catch(() => ({ rows: [] }));
      wabaId = w.rows[0]?.waba_id || null;
    }

    const userData = buildUserData(phone);
    if (ctwaClid) userData.ctwa_clid = ctwaClid;
    if (wabaId) userData.whatsapp_business_account_id = wabaId;

    // What the sale was worth. Without it Meta is told a purchase happened and
    // nothing about its size, which counts conversions but cannot optimise for
    // the valuable ones or report a return on spend. A caller that already
    // holds the figure - the slip it just read - keeps it; otherwise the order
    // is priced by the same rule the income page uses.
    const data = { ...customData };
    if (!(parseFloat(data.value) > 0) && data.order_id && db.IS_PG) {
      const r = await db.pgQuery(
        `SELECT custom_fields FROM orders WHERE order_id=$1 AND client_id=$2 LIMIT 1`,
        [data.order_id, clientId]
      ).catch(() => ({ rows: [] }));
      const v = orderValue(r.rows[0]?.custom_fields);
      if (v > 0) data.value = v;
    }
    if (parseFloat(data.value) > 0 && !data.currency) data.currency = 'LKR';

    const payload = {
      data: [{
        event_name:    eventName,
        event_time:    Math.floor(Date.now() / 1000),
        // A conversion that happened in a chat, not on a website.
        //
        // business_messaging is the accurate value and the one that lets a
        // click id attribute the sale to its ad, but Meta will only accept it
        // with messaging_channel and the owning account named alongside -
        // lowercase 'whatsapp', and 'WhatsApp' is refused. Without the WABA
        // id the whole event is rejected, so we fall back to 'other' instead:
        // a sale Meta counts imprecisely beats a sale it never hears about.
        action_source: (ctwaClid && wabaId) ? 'business_messaging' : 'other',
        ...((ctwaClid && wabaId) && { messaging_channel: 'whatsapp' }),
        user_data:     userData,
        custom_data:   data,
      }],
      access_token: cfg.accessToken,
      ...(cfg.testEventCode && { test_event_code: cfg.testEventCode }),
    };

    if (cfg.testEventCode) {
      console.warn(
        `[META-CAPI] TEST MODE (${cfg.testEventCode}) - this ${eventName} will show in `
        + 'Test Events and will NOT count towards attribution or optimisation. '
        + 'Clear test_event_code when you are done verifying.'
      );
    }

    const r = await axios.post(
      `https://graph.facebook.com/v18.0/${cfg.pixelId}/events`,
      payload,
      { headers: { 'Content-Type': 'application/json' } }
    );
    const received = r.data.events_received;
    console.log(`[META-CAPI] ${eventName} sent for ...${phone.slice(-4)}: events_received=${received} value=${data.value || 0} click=${!!ctwaClid} waba=${!!wabaId}`);
    await _logEvent(clientId, eventName, phone, cfg.testEventCode ? 'test' : 'ok',
      `events_received=${received}${data.value > 0 ? ` LKR ${data.value}` : ' (no value on record)'}${ctwaClid ? ' +click' : ' (no click id, attribution will be weak)'}`);
  } catch (e) {
    const msg = e?.response?.data?.error?.message || e.message;
    console.warn(`[META-CAPI] Failed to send ${eventName} for ...${phone.slice(-4)}:`, msg);
    await _logEvent(clientId, eventName, phone, 'error', msg);
  }
}

/**
 * Sync all paid/delivered customer phones (+ names) to a Meta Custom Audience.
 */
async function syncAudienceForClient(clientId) {
  const cfg = await _getConfig(clientId);
  if (!cfg) throw new Error('meta_conversions addon not enabled or missing pixel_id / api_key config');
  if (!cfg.audienceId) throw new Error('audience_id not configured — create an audience first');

  const r = await db.pgQuery(
    `SELECT DISTINCT o.phone_number, c.name
     FROM orders o
     LEFT JOIN customers c ON c.phone_number = o.phone_number AND c.client_id = o.client_id
     WHERE o.client_id=$1
       AND o.status IN ('payment_received','paid','delivered','done','complete')
       AND o.phone_number IS NOT NULL`,
    [clientId]
  );
  const rows = r.rows;
  if (!rows.length) return { synced: 0, total: 0 };

  const BATCH_SIZE = 10000;
  let totalReceived = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const schema = ['PHONE', 'FN', 'LN'];
    const data = batch.map(row => {
      const parts = (row.name || '').trim().split(/\s+/).filter(Boolean);
      return [
        hashPhone(row.phone_number),
        parts[0] ? hashStr(parts[0].toLowerCase()) : '',
        parts.length > 1 ? hashStr(parts.slice(1).join(' ').toLowerCase()) : '',
      ];
    });

    let resp;
    try {
      resp = await axios.post(
        `https://graph.facebook.com/v18.0/${cfg.audienceId}/users`,
        { payload: { schema, data }, access_token: cfg.accessToken },
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (e) {
      throw metaError(e, `Could not add customers to audience ${cfg.audienceId}`);
    }
    totalReceived += resp.data.num_received || batch.length;
    console.log(`[META-AUDIENCE] Batch ${Math.floor(i / BATCH_SIZE) + 1}: received=${resp.data.num_received} invalid=${resp.data.num_invalid_entries || 0}`);
  }

  return { synced: totalReceived, total: rows.length };
}

/**
 * Turn an axios failure into what Meta said was wrong.
 *
 * Without this the caller gets "Request failed with status code 400", which
 * names the status and not the cause. Meta puts a usable sentence in
 * error.message, and error_user_msg when it has one written for a human.
 *
 * The permission case is called out by name because it is both the likeliest
 * failure and the least obvious: a Conversions API token is scoped to the
 * dataset, while creating or filling an audience is an ad account operation.
 * The same token that sends events happily will refuse this.
 *
 * @param {Error} e
 * @param {string} what the operation being attempted, for the message
 * @returns {Error}
 */
function metaError(e, what) {
  const err = e?.response?.data?.error;
  if (!err) return e;

  const bits = [err.error_user_msg || err.message].filter(Boolean);
  if (err.code === 200 || err.code === 10 || err.type === 'OAuthException') {
    bits.push(
      'This usually means the access token is not permitted to do this. A '
      + 'Conversions API token generated in Events Manager can send events but '
      + 'cannot manage audiences - that needs a token with ads_management on '
      + 'the ad account, and the Custom Audience terms accepted for it.'
    );
  }
  const out = new Error(`${what}: ${bits.join(' ')}`);
  out.statusCode = e?.response?.status === 400 ? 400 : (e?.response?.status || 500);
  return out;
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

  let r;
  try {
    r = await axios.post(
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
  } catch (e) {
    throw metaError(e, `Could not create the audience in ${adAccountId}`);
  }
  const audienceId = r.data.id;

  await db.upsertPluginConfig(clientId, 'meta_conversions', { ...config, audience_id: audienceId });
  console.log(`[META-AUDIENCE] Created audience "${audienceName}" id=${audienceId} for client ${clientId}`);
  return audienceId;
}

/**
 * Return the last 30 CAPI log entries for a client (newest first).
 */
async function getRecentEvents(clientId) {
  if (!db.IS_PG) return [];
  const r = await db.pgQuery(
    `SELECT event_name, phone_last4, status, detail, created_at
     FROM meta_capi_log WHERE client_id=$1
     ORDER BY created_at DESC LIMIT 30`,
    [clientId]
  );
  return r.rows;
}

module.exports = { fireCAPIEvent, syncAudienceForClient, createAudienceForClient, getRecentEvents, hashPhone };
