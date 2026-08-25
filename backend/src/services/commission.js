/**
 * @module services/commission
 * @description Turning credited sales into what an operator is owed.
 *
 * The rate steps up once an operator passes a number of sales in a month, and
 * the higher rate applies only from the sale after the threshold, never
 * backwards over the ones already made. So a sale's position in its month is
 * what decides its rate, which is why credit_seq is frozen when the sale is
 * credited rather than counted at payout time.
 *
 * The scheme is configuration, not code. Nothing here knows pj's numbers; it
 * knows the shape. Changing a rate is data entry, and past periods keep the
 * numbers they were calculated with because a closed period stores its own.
 */

'use strict';

const db = require('../db');

/**
 * @typedef  {Object} Tier
 * @property {number} from  - the sale number this rate starts applying at (1-based)
 * @property {number} rate  - percent of the sale, or a flat amount, per `basis`
 *
 * @typedef  {Object} Scheme
 * @property {'percent'|'flat'} basis - percent of the sale amount, or a fixed sum per sale
 * @property {Tier[]} tiers           - ascending by `from`; the first must start at 1
 * @property {string} [currency]
 */

/** No scheme configured yet. Deliberately empty rather than a guessed default. */
const EMPTY_SCHEME = { basis: 'percent', tiers: [], currency: 'LKR' };

/**
 * Read a client's scheme.
 *
 * @param {string} clientId
 * @returns {Promise<Scheme>}
 */
async function getScheme(clientId) {
  const r = await db.pgQuery(
    `SELECT config FROM plugin_configs WHERE client_id=$1 AND plugin_id='commission'`, [clientId]);
  const cfg = r.rows[0]?.config;
  const parsed = typeof cfg === 'string' ? JSON.parse(cfg) : cfg;
  return normalise(parsed);
}

/**
 * Save a client's scheme.
 *
 * @param {string} clientId
 * @param {Scheme} scheme
 * @returns {Promise<Scheme>}
 */
async function saveScheme(clientId, scheme) {
  const clean = normalise(scheme);
  await db.pgQuery(
    `INSERT INTO plugin_configs (client_id, plugin_id, config)
     VALUES ($1,'commission',$2::jsonb)
     ON CONFLICT (client_id, plugin_id) DO UPDATE SET config=$2::jsonb`,
    [clientId, JSON.stringify(clean)]);
  return clean;
}

/**
 * Coerce whatever was stored into a scheme that can be reasoned about.
 *
 * Tiers are sorted and de-duplicated on `from`, because two tiers claiming the
 * same sale number is not a disagreement anyone should have to resolve at
 * payout time.
 *
 * @param {*} raw
 * @returns {Scheme}
 */
function normalise(raw) {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_SCHEME };
  const basis = raw.basis === 'flat' ? 'flat' : 'percent';
  const seen = new Set();
  const tiers = (Array.isArray(raw.tiers) ? raw.tiers : [])
    .map(t => ({ from: Math.max(1, parseInt(t.from, 10) || 1), rate: Number(t.rate) || 0 }))
    .filter(t => Number.isFinite(t.rate))
    .sort((a, b) => a.from - b.from)
    .filter(t => (seen.has(t.from) ? false : seen.add(t.from)));
  return { basis, tiers, currency: raw.currency || 'LKR' };
}

/**
 * The rate that applies to the nth sale of a month.
 *
 * Forward-only: crossing the threshold changes what the next sale pays, not
 * what the previous ones paid.
 *
 * @param {Scheme} scheme
 * @param {number} seq - the sale's position in the operator's month, 1-based
 * @returns {number} 0 when no tier covers it
 */
function rateFor(scheme, seq) {
  let rate = 0;
  for (const t of scheme.tiers) {
    if (seq >= t.from) rate = t.rate;
    else break;
  }
  return rate;
}

/**
 * What one sale earns.
 *
 * @param {Scheme} scheme
 * @param {number} seq
 * @param {number} amount - the sale value
 * @returns {number}
 */
function commissionForSale(scheme, seq, amount) {
  const rate = rateFor(scheme, seq);
  if (!rate) return 0;
  return scheme.basis === 'flat' ? rate : (Number(amount) || 0) * rate / 100;
}

/**
 * Total a set of credited sales.
 *
 * Each sale is priced by its own frozen sequence number, so the answer does not
 * depend on the order they are handed in or on anything that happened after.
 *
 * @param {Scheme} scheme
 * @param {Array<{credit_seq: number, amount: number}>} sales
 * @returns {{total: number, lines: Array<{seq: number, amount: number, rate: number, commission: number}>}}
 */
function totalFor(scheme, sales) {
  const lines = sales.map(s => {
    const seq = parseInt(s.credit_seq, 10) || 0;
    const amount = Number(s.amount) || 0;
    const rate = rateFor(scheme, seq);
    return { seq, amount, rate, commission: commissionForSale(scheme, seq, amount) };
  });
  return { total: lines.reduce((a, l) => a + l.commission, 0), lines };
}

/**
 * Whether a scheme can actually pay anything.
 *
 * Used to say "no scheme configured" rather than quietly reporting zero, which
 * looks identical to an operator who sold nothing.
 *
 * @param {Scheme} scheme
 * @returns {boolean}
 */
function isConfigured(scheme) {
  return Array.isArray(scheme?.tiers) && scheme.tiers.length > 0;
}

module.exports = {
  getScheme, saveScheme, normalise, rateFor, commissionForSale, totalFor, isConfigured, EMPTY_SCHEME,
};
