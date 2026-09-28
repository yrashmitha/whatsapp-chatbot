'use strict';

const crypto = require('crypto');
const axios  = require('axios');
const db     = require('../db');
const { orderValue } = require('./salesCredit');

function hashStr(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

const MONTHS = {
  'ජනවාරි': 1, 'පෙබරවාරි': 2, 'මාර්තු': 3, 'අප්‍රේල්': 4, 'මැයි': 5, 'ජූනි': 6, 'ජුනි': 6,
  'ජූලි': 7, 'ජුලි': 7, 'අගෝස්තු': 8, 'සැප්තැම්බර්': 9, 'ඔක්තෝබර්': 10, 'ඔක්තෝම්බර්': 10,
  'නොවැම්බර්': 11, 'දෙසැම්බර්': 12,
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * A customer's birth date as Meta's `db` wants it (YYYYMMDD), or null.
 *
 * The date is typed by customers, so the same day arrives as 1990.03.15,
 * 1990/3/15, 15/03/1990, "1990 මාර්තු 15" or "1990 March 15". Anything with two
 * dates in it (a couple's), or that does not read as one real date, is dropped:
 * a wrong date only lowers the match score.
 */
function parseBirthDate(raw) {
  const s = String(raw || '').trim();
  if (!s || (s.match(/\d{4}/g) || []).length !== 1) return null;
  let y, m, d, x;
  if ((x = s.match(/^\D{0,2}(\d{4})\s*[./\-,\s]\s*(\d{1,2})\s*[./\-,\s]\s*(\d{1,2})\.?\s*$/))) {
    [y, m, d] = [x[1], x[2], x[3]];
  } else if ((x = s.match(/^(\d{1,2})\s*[./\-]\s*(\d{1,2})\s*[./\-]\s*(\d{4})$/))) {
    [d, m, y] = [x[1], x[2], x[3]];
  } else if ((x = s.match(/^(\d{4})\s*[.\-\s]*\s*([^\d\s./\-,]+)\s*[.\-\s]*\s*(\d{1,2})(?:\s|$)/))) {
    y = x[1]; d = x[3];
    const name = x[2].toLowerCase();
    m = MONTHS[name] || MONTHS[name.slice(0, 3)];
    if (!m) return null;
  } else {
    return null;
  }
  y = +y; m = +m; d = +d;
  if (m > 12 && d <= 12) [m, d] = [d, m];
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (y < 1900 || y > new Date().getUTCFullYear() - 10
      || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
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
function buildUserData(phone, birthDate) {
  const digits = (phone || '').replace(/\D/g, '');
  const userData = { ph: [hashPhone(phone)] };

  // Every extra identifier lifts the match quality score, and the score is not
  // cosmetic: it is how confidently Meta ties a sale to the person who saw the
  // ad, and therefore how well it can optimise. A hashed phone on its own
  // scores badly.
  //
  // The country is free - a Sri Lankan number begins 94 - and external_id lets
  // Meta recognise a returning customer across events without knowing who they
  // are. Neither says anything about the person that the phone number did not
  // already say.
  if (digits.startsWith('94')) userData.country = [hashStr('lk')];
  if (digits) userData.external_id = [hashStr(digits)];

  // Date of birth, when the order has one Meta can read.
  const dob = parseBirthDate(birthDate);
  if (dob) userData.db = [hashStr(dob)];

  return userData;
}

/**
 * Ask Meta for the dataset attached to this client's WhatsApp Business Account.
 *
 * POST /{waba_id}/dataset is retrieve-or-create: it returns the existing one if
 * there is one and makes it if there is not, so calling it is idempotent. The
 * answer is cached on the client so this is a one-off per client rather than a
 * round trip on every sale.
 *
 * Returns null on any failure, which drops the caller back to whatever is
 * configured in the plugin rather than dropping the event.
 *
 * @param {string} clientId
 * @param {{waba_id: string, wa_token: string}} row
 * @returns {Promise<string|null>}
 */
async function _resolveWaDataset(clientId, row) {
  try {
    const r = await axios.post(
      `https://graph.facebook.com/v18.0/${row.waba_id}/dataset`,
      {},
      { params: { access_token: row.wa_token } }
    );
    const id = r.data?.id;
    if (!id) return null;
    await db.pgQuery('UPDATE client_configs SET wa_dataset_id=$1 WHERE client_id=$2',
      [id, clientId]).catch(() => {});
    console.log(`[META-CAPI] ${clientId}: WhatsApp dataset is ${id}`);
    return id;
  } catch (e) {
    console.warn(`[META-CAPI] ${clientId}: could not resolve the WhatsApp dataset:`,
      e?.response?.data?.error?.message || e.message);
    return null;
  }
}

async function _getConfig(clientId) {
  if (!db.IS_PG) return null;
  const addonCheck = await db.pgQuery(
    `SELECT enabled FROM client_addons WHERE client_id=$1 AND addon_id='meta_conversions' AND enabled=TRUE`,
    [clientId]
  );
  if (!addonCheck.rows.length) return null;
  const config = await db.getPluginConfig(clientId, 'meta_conversions');

  // A click-to-WhatsApp conversion belongs to the dataset attached to the
  // WhatsApp Business Account. A dataset created by hand in Events Manager
  // has no WABA linked and Meta rejects business_messaging events sent to
  // it outright. POST /{waba_id}/dataset is retrieve-or-create, so asking
  // for it is cheap and always correct, and it needs the WhatsApp token -
  // the Events Manager token cannot see that dataset at all.
  //
  // The plugin's own pixel_id and api_key stay as an override, for a client
  // sending conversions from somewhere that is not WhatsApp.
  let waDataset = null;
  let waToken   = null;
  const w = await db.pgQuery(
    'SELECT waba_id, wa_token, wa_dataset_id FROM client_configs WHERE client_id=$1',
    [clientId]
  ).catch(() => ({ rows: [] }));
  const row = w.rows[0];
  if (row?.waba_id && row?.wa_token) {
    waToken = row.wa_token;
    waDataset = row.wa_dataset_id || await _resolveWaDataset(clientId, row);
  }

  const pixelId     = waDataset || config.pixel_id;
  const accessToken = waDataset ? waToken : config.api_key;
  if (!pixelId || !accessToken) return null;

  // A second dataset to copy the conversion into, when the configured one is
  // not the one already being used. It exists because the WhatsApp dataset can
  // be invisible to the ad account that spends the money - they sit in
  // different business portfolios, and Meta bars a new portfolio from sharing
  // assets for the first few weeks. A conversion no campaign can read is worth
  // nothing, so it is reported twice.
  const mirror = (config.pixel_id && config.api_key && config.pixel_id !== pixelId)
    ? { pixelId: config.pixel_id, accessToken: config.api_key }
    : null;

  return {
    pixelId,
    accessToken,
    adAccountId: config.ad_account_id || '',
    audienceId:  config.audience_id   || '',
    mirror,
    // Set only while verifying the setup. Events carrying a code land in Events
    // Manager under Test Events and are kept out of attribution and
    // optimisation, so a smoke test cannot teach the campaign about a sale that
    // never happened. Left in by accident it would quietly exclude every real
    // purchase, which is why fireCAPIEvent shouts about it on every send.
    testEventCode: config.test_event_code || '',
  };
}

/**
 * Record an attempt, and keep the event body so it can be sent again.
 *
 * The body matters more than the outcome. Sales are going to a dataset the ad
 * account cannot see, and when that is unblocked there will be weeks of them to
 * replay - which is only possible if what was sent was kept. The stored user
 * data is already hashed, so this holds nothing the orders table does not.
 *
 * @param {string} clientId
 * @param {string} eventName
 * @param {string} phone
 * @param {'ok'|'error'|'test'} status
 * @param {string} detail
 * @param {object} [extra] dataset_id, event and order ids, and the event body
 */
async function _logEvent(clientId, eventName, phone, status, detail, extra = {}) {
  if (!db.IS_PG) return;
  const last4 = (phone || '').replace(/\D/g, '').slice(-4);
  db.pgQuery(
    `INSERT INTO meta_capi_log
       (client_id, event_name, phone_last4, status, detail,
        payload, dataset_id, event_id, order_id, action_source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [clientId, eventName, last4, status, detail || null,
     extra.payload ? JSON.stringify(extra.payload) : null,
     extra.datasetId || null, extra.eventId || null,
     extra.orderId || null, extra.actionSource || null]
  ).catch((e) => console.warn('[META-CAPI] could not log the event:', e.message));
}

/**
 * Unix seconds for event_time. A send made when the thing happened uses now; a
 * retry passes when it really happened so the sale stays next to its click.
 * Meta drops events more than 7 days old, and a wrong time still counts where a
 * dropped event does not, so anything older (or unusable) falls back to now.
 */
function _eventTime(when) {
  const now = Math.floor(Date.now() / 1000);
  const t = when ? Math.floor(new Date(when).getTime() / 1000) : NaN;
  if (!Number.isFinite(t) || t > now || now - t > 7 * 24 * 3600 - 300) return now;
  return t;
}

/**
 * Fire a Meta Conversions API event. Looks up customer name automatically.
 * Silent no-op if the addon isn't enabled or config is missing.
 */
async function fireCAPIEvent(clientId, eventName, phone, customData = {}, opts = {}) {
  if (!clientId || !phone) return { ok: false, error: 'no client or phone' };

  // Callers in the message path ignore this and must keep doing so - a failed
  // conversion can never be allowed to interrupt a reply to a customer. It is
  // returned for the retry button, which has to be able to say what happened
  // instead of reading the log back and racing the writes to it.
  let result = { ok: false, error: 'not configured' };

  try {
    const cfg = await _getConfig(clientId);
    if (!cfg) return result;

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

    // The order's stored fields: the sale's value, and the customer's birth date.
    const data = { ...customData };
    let birthDate = null;
    if (data.order_id && db.IS_PG) {
      const r = await db.pgQuery(
        `SELECT custom_fields FROM orders WHERE order_id=$1 AND client_id=$2 LIMIT 1`,
        [data.order_id, clientId]
      ).catch(() => ({ rows: [] }));
      const cf = r.rows[0]?.custom_fields;
      birthDate = (typeof cf === 'string' ? (() => { try { return JSON.parse(cf); } catch (_) { return {}; } })() : cf)?.birth_date || null;
      // What the sale was worth. Without it Meta is told a purchase happened and
      // nothing about its size. A caller that already holds the figure - the slip
      // it just read - keeps it; otherwise the order is priced by the same rule
      // the income page uses.
      if (!(parseFloat(data.value) > 0)) {
        const v = orderValue(cf);
        if (v > 0) data.value = v;
      }
    }

    const userData = buildUserData(phone, birthDate);
    if (ctwaClid) userData.ctwa_clid = ctwaClid;
    if (wabaId) userData.whatsapp_business_account_id = wabaId;

    // Meta requires a currency on every Purchase, including one worth nothing:
    // "Your purchase event doesn't include a currency parameter." Attaching it
    // only alongside a known value meant that an order with no price on record
    // was rejected outright rather than counted as a conversion without an
    // amount, which is the more useful of the two.
    if (eventName === 'Purchase' || parseFloat(data.value) > 0) {
      if (!data.currency) data.currency = 'LKR';
      if (!(parseFloat(data.value) > 0)) data.value = 0;
    }

    // Everything business_messaging needs, present together or not at all.
    const messaging = Boolean(ctwaClid && wabaId);

    const payload = {
      data: [{
        // Messaging conversions use their own vocabulary: Meta rejects "Lead"
        // outright under business_messaging and asks for "LeadSubmitted". The
        // name is translated here rather than at the call sites, which should
        // go on describing what happened rather than tracking Meta's naming.
        //
        // Translated always, not only when the click id is present. Doing it
        // conditionally split one event across two names - LeadSubmitted for
        // customers who arrived from an ad, Lead for everyone else - so Events
        // Manager listed three event types for two things that happen, the
        // volume was divided, and only one of the halves could be optimised on.
        // Confirmed that LeadSubmitted is accepted with action_source 'other'
        // as well, so there is no reason to keep both.
        event_name:    eventName === 'Lead' ? 'LeadSubmitted' : eventName,
        event_time:    _eventTime(opts.eventTime),
        // Meta deduplicates on event_id, and without one every send counts as
        // another sale. A webhook retry, a status set twice, or a re-fire while
        // testing would each invent a purchase that never happened and teach
        // the campaign to chase it. One order can only be sold once, so the
        // order id and the event name are exactly the right key.
        ...(data.order_id && { event_id: `${eventName}:${data.order_id}` }),
        // A conversion that happened in a chat, not on a website.
        //
        // business_messaging is the accurate value and the one that lets a
        // click id attribute the sale to its ad, but Meta will only accept it
        // with messaging_channel and the owning account named alongside -
        // lowercase 'whatsapp', and 'WhatsApp' is refused. Without the WABA
        // id the whole event is rejected, so we fall back to 'other' instead:
        // a sale Meta counts imprecisely beats a sale it never hears about.
        action_source: messaging ? 'business_messaging' : 'other',
        ...(messaging && { messaging_channel: 'whatsapp' }),
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

    // The same sale, to the dataset the ad account can see. That dataset has no
    // WhatsApp Business Account attached and rejects business_messaging, so it
    // goes as 'other'. The click id, the value and the currency are unchanged.
    if (cfg.mirror) {
      const copy = JSON.parse(JSON.stringify(payload.data[0]));
      copy.event_name = eventName;
      copy.action_source = 'other';
      delete copy.messaging_channel;
      delete copy.user_data.whatsapp_business_account_id;
      await axios.post(
        `https://graph.facebook.com/v18.0/${cfg.mirror.pixelId}/events`,
        {
          data: [copy],
          access_token: cfg.mirror.accessToken,
          ...(cfg.testEventCode && { test_event_code: cfg.testEventCode }),
        },
        { headers: { 'Content-Type': 'application/json' } }
      ).then(() => {
        console.log(`[META-CAPI] mirrored ${eventName} to ${cfg.mirror.pixelId}`);
        // Its own row: the two datasets took different bodies, and a replay has
        // to know which of them a given sale already reached.
        _logEvent(clientId, eventName, phone, cfg.testEventCode ? 'test' : 'ok',
          `mirrored to ${cfg.mirror.pixelId}`,
          { payload: copy, datasetId: cfg.mirror.pixelId, eventId: copy.event_id,
            orderId: data.order_id, actionSource: copy.action_source });
      }).catch((e) => {
        // The mirror is a convenience, not the record. A dataset that refuses
        // it must not take the real conversion down with it.
        const err = e?.response?.data?.error;
        console.warn(`[META-CAPI] mirror to ${cfg.mirror.pixelId} failed:`,
          err?.error_user_msg || err?.message || e.message);
      });
    }
    console.log(`[META-CAPI] ${eventName} sent for ...${phone.slice(-4)}: events_received=${received} value=${data.value || 0} click=${!!ctwaClid} waba=${!!wabaId}`);
    result = { ok: true, received, value: data.value || 0, messaging, test: !!cfg.testEventCode };
    const _event = payload.data[0];
    await _logEvent(clientId, eventName, phone, cfg.testEventCode ? 'test' : 'ok',
      `events_received=${received}${data.value > 0 ? ` LKR ${data.value}` : ' (no value on record)'}${ctwaClid ? ' +click' : ' (no click id, attribution will be weak)'}`,
      { payload: _event, datasetId: cfg.pixelId, eventId: _event.event_id,
        orderId: data.order_id, actionSource: _event.action_source });
  } catch (e) {
    // Meta puts the generic "Invalid parameter" in message and the sentence
    // that actually says what is wrong in error_user_msg. Keeping only the
    // former is how a rejected event looks like an unexplained failure.
    const err = e?.response?.data?.error;
    const msg = [err?.error_user_msg, err?.message].filter(Boolean).join(' | ') || e.message;
    result = { ok: false, error: msg };
    console.warn(`[META-CAPI] Failed to send ${eventName} for ...${phone.slice(-4)}:`, msg);
    await _logEvent(clientId, eventName, phone, 'error', msg);
  }

  return result;
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

module.exports = { parseBirthDate, fireCAPIEvent, syncAudienceForClient, createAudienceForClient, getRecentEvents, hashPhone };
