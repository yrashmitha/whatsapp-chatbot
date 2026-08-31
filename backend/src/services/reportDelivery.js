/**
 * @module services/reportDelivery
 * @description Self-service report delivery.
 *
 * Every horoscope/marriage/match/quantum/tarot order carries a `delivery_token`
 * (128-bit random, base62). The customer is handed
 * `${DELIVERY_BASE_URL}/r/<token>` inside the order chat at purchase time. The
 * report only becomes downloadable once an operator presses "Report is ready"
 * in the editor drawer, which stamps `delivery_released_at`. A generated but
 * un-released report still shows the "check back later" page.
 *
 * The public delivery site (pahantharu_web) never touches this DB directly — it
 * calls the `/internal/delivery/*` endpoints with the shared X-Delivery-Key.
 */

'use strict';

const crypto = require('crypto');
const { pgQuery } = require('../db/connection');
const { DELIVERY_BASE_URL } = require('../config/env');

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Encode a Buffer as a zero-padded base62 string. */
function toBase62(buf) {
  let n = BigInt('0x' + buf.toString('hex'));
  let out = '';
  const b = 62n;
  while (n > 0n) {
    out = BASE62[Number(n % b)] + out;
    n /= b;
  }
  return out.padStart(22, '0');
}

/** A fresh 128-bit delivery token (22 base62 chars, ~2e38 keyspace). */
function newToken() {
  return toBase62(crypto.randomBytes(16));
}

/** Full customer-facing URL for a token. */
function deliveryUrl(token) {
  return token ? `${DELIVERY_BASE_URL}/r/${token}` : null;
}

/** Parse a jsonb/text column that may already be an object. */
function parseJson(v) {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return {}; }
}

/**
 * Which report a released order should hand over. An explicit `delivery_kind`
 * (set when the operator releases from a specific drawer) always wins; otherwise
 * infer from whatever content the order carries.
 *
 * @returns {'horoscope'|'marriage'|'match'|'quantum'|'tarot'|null}
 */
function detectKind(order) {
  if (order.delivery_kind) return order.delivery_kind;
  const hd = parseJson(order.horoscope_data);
  const td = parseJson(order.tarot_data);
  if (Array.isArray(hd.match_sections_data) && hd.match_sections_data.length) return 'match';
  if (Array.isArray(hd.marriage_sections_data) && hd.marriage_sections_data.length) return 'marriage';
  if (hd.sections && Object.keys(hd.sections).length) return 'horoscope';
  if ((Array.isArray(hd.quantum_sections_data) && hd.quantum_sections_data.length) || hd.quantum_reading) return 'quantum';
  if (td && td.reading && td.cards) return 'tarot';
  return null;
}

/** Does the order actually carry finished content for the given kind? */
function hasContentForKind(order, kind) {
  const hd = parseJson(order.horoscope_data);
  const td = parseJson(order.tarot_data);
  switch (kind) {
    case 'match':     return Array.isArray(hd.match_sections_data) && hd.match_sections_data.length > 0;
    case 'marriage':  return Array.isArray(hd.marriage_sections_data) && hd.marriage_sections_data.length > 0;
    case 'horoscope': return !!hd.sections && Object.keys(hd.sections).length > 0;
    case 'quantum':   return (Array.isArray(hd.quantum_sections_data) && hd.quantum_sections_data.length > 0) || !!hd.quantum_reading;
    case 'tarot':     return !!td && !!td.reading && !!td.cards;
    default:          return false;
  }
}

const VALID_KINDS = ['horoscope', 'marriage', 'match', 'quantum', 'tarot'];

// ── Row access ──────────────────────────────────────────────────────────────

const DELIVERY_COLS =
  'order_id, client_id, phone_number, custom_fields, horoscope_data, tarot_data, ' +
  'delivery_token, delivery_kind, delivery_released_at, delivery_phone_gate, ' +
  'delivery_opened_at, delivery_downloads';

async function getOrderByToken(token) {
  if (!token || !/^[0-9A-Za-z]{16,40}$/.test(token)) return null;
  const { rows } = await pgQuery(
    `SELECT ${DELIVERY_COLS} FROM orders WHERE delivery_token = $1`, [token]
  );
  return rows[0] || null;
}

async function getDeliveryRow(orderId, clientId) {
  const { rows } = clientId
    ? await pgQuery(`SELECT ${DELIVERY_COLS} FROM orders WHERE order_id = $1 AND client_id = $2`, [orderId, clientId])
    : await pgQuery(`SELECT ${DELIVERY_COLS} FROM orders WHERE order_id = $1`, [orderId]);
  return rows[0] || null;
}

/** Guarded UPDATE: only touches the row when it exists and (if given) is owned by clientId. */
async function updateDeliveryRow(orderId, clientId, setClause, params) {
  const where = clientId ? 'order_id = $1 AND client_id = $2' : 'order_id = $1';
  const base = clientId ? [orderId, clientId] : [orderId];
  await pgQuery(`UPDATE orders SET ${setClause} WHERE ${where}`, [...base, ...params]);
}

/**
 * Ensure the order has a delivery token, minting one if absent. Safe to call
 * repeatedly. Returns the token (existing or new), or null if the order is
 * missing / not owned by clientId.
 */
async function ensureToken(orderId, clientId) {
  const row = await getDeliveryRow(orderId, clientId);
  if (!row) return null;
  if (row.delivery_token) return row.delivery_token;
  // Retry once on the (astronomically unlikely) unique-index collision.
  for (let i = 0; i < 3; i++) {
    const token = newToken();
    try {
      const { rows } = await pgQuery(
        `UPDATE orders SET delivery_token = $1
           WHERE order_id = $2 AND delivery_token IS NULL
         RETURNING delivery_token`,
        [token, orderId]
      );
      if (rows[0]) return rows[0].delivery_token;
      // Someone else set it first — re-read.
      const fresh = await getDeliveryRow(orderId, clientId);
      if (fresh && fresh.delivery_token) return fresh.delivery_token;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  return null;
}

async function setReleased(orderId, clientId, released, kind) {
  const k = VALID_KINDS.includes(kind) ? kind : null;
  const n = clientId ? 3 : 2; // first free placeholder after the WHERE params
  if (released) {
    const set = k
      ? `delivery_released_at = NOW(), delivery_kind = $${n}`
      : `delivery_released_at = NOW()`;
    await updateDeliveryRow(orderId, clientId, set, k ? [k] : []);
  } else {
    await updateDeliveryRow(orderId, clientId, `delivery_released_at = NULL`, []);
  }
}

async function setPhoneGate(orderId, clientId, on) {
  const n = clientId ? 3 : 2;
  await updateDeliveryRow(orderId, clientId, `delivery_phone_gate = $${n}`, [!!on]);
}

async function markOpened(orderId) {
  await pgQuery(
    `UPDATE orders SET delivery_opened_at = COALESCE(delivery_opened_at, NOW()) WHERE order_id = $1`,
    [orderId]
  );
}

async function bumpDownloads(orderId) {
  await pgQuery(
    `UPDATE orders SET delivery_downloads = delivery_downloads + 1 WHERE order_id = $1`,
    [orderId]
  );
}

// ── Phone gate ──────────────────────────────────────────────────────────────

/** Last 4 digits of the order's phone number. */
function phoneLast4(order) {
  return String(order.phone_number || '').replace(/\D/g, '').slice(-4);
}

/** Constant-time check of a customer-supplied last-4 against the order. */
function verifyLast4(order, supplied) {
  const want = phoneLast4(order);
  const got = String(supplied || '').replace(/\D/g, '').slice(-4);
  if (want.length !== 4 || got.length !== 4) return false;
  return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got));
}

// ── Status projection (what the public site renders) ─────────────────────────

/**
 * @param {object} order - a row from getOrderByToken
 * @returns {{status:'pending'|'ready', kind:string|null, phoneGate:boolean,
 *            released:boolean, hasContent:boolean}}
 */
function projectStatus(order) {
  const kind = detectKind(order);
  const released = !!order.delivery_released_at;
  const hasContent = kind ? hasContentForKind(order, kind) : false;
  return {
    status: released && hasContent ? 'ready' : 'pending',
    kind,
    released,
    hasContent,
    phoneGate: order.delivery_phone_gate !== false,
  };
}

module.exports = {
  newToken,
  deliveryUrl,
  detectKind,
  hasContentForKind,
  projectStatus,
  getOrderByToken,
  getDeliveryRow,
  ensureToken,
  setReleased,
  setPhoneGate,
  markOpened,
  bumpDownloads,
  phoneLast4,
  verifyLast4,
  VALID_KINDS,
};
