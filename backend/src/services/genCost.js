/**
 * @module services/genCost
 * @description Tracks the Gemini spend of generating a report and accumulates it
 * onto the order.
 *
 * `orders.gen_cost_usd` is a running total: regenerating a report adds the new
 * run's cost on top, because that money was really spent. `orders.gen_runs` is
 * the per-run audit trail (one JSON entry per generation) so the total can be
 * explained.
 *
 * Postgres only — the SQLite dev shim has no jsonb concat and cost tracking is
 * not needed there.
 */

'use strict';

const db = require('../db');

// Prices come from geminiModels.js, per model. Before 2026-10-29 this file
// priced everything at 0.15 in / 2.50 out; Google lists gemini-2.5-flash at
// 0.30 in, so input on earlier reports was recorded at half its cost. Earlier
// still (until 2026-09-29) it was 0.075 / 0.30, which are 1.5/2.0 Flash prices.
const { DEFAULT_MODEL, pricePerToken } = require('./geminiModels');
const { getClientModel } = require('./clientKeys');

/**
 * A running tally of token usage across the many model calls in one report run.
 *
 * Callers do not say which model ran: the client's setting decides that, and
 * recordOrderGenCost prices the tokens against it. `totals.cost_usd` is priced
 * as `model` (the default if omitted) and is only exact when that matches.
 *
 * @param {string} [model]
 * @returns {{ add: (usage:object|undefined)=>void, tokens: {in:number,out:number}, totals: {in_tokens:number,out_tokens:number,calls:number,cost_usd:number} }}
 */
function makeMeter(model = DEFAULT_MODEL) {
  let inTok = 0, outTok = 0, calls = 0;
  return {
    get tokens() { return { in: inTok, out: outTok }; },
    add(usage) {
      if (!usage) return;
      inTok  += usage.promptTokenCount || 0;
      // thoughtsTokenCount is billed at the output rate on 2.5 models.
      outTok += (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0);
      calls  += 1;
    },
    get totals() {
      const p = pricePerToken(model);
      const cost = inTok * p.input + outTok * p.output;
      return { in_tokens: inTok, out_tokens: outTok, calls, cost_usd: Number(cost.toFixed(8)) };
    },
  };
}

/**
 * Append this run to the order and bump its accumulated cost.
 *
 * @param {string} orderId
 * @param {string} kind    - 'horoscope' | 'wa_message' | 'section' | 'match' | 'tarot' | 'quantum'
 * @param {ReturnType<makeMeter>} meter
 * @param {object} [extra] - extra fields to record on the run entry
 * @returns {Promise<object>} the run's totals
 */
async function recordOrderGenCost(orderId, kind, meter, extra = {}) {
  let t = meter.totals;
  if (!orderId || !db.IS_PG) return t;
  if (t.calls === 0) return t;

  // Price the run against the model the order's client is set to.
  let model = DEFAULT_MODEL;
  try {
    const r = await db.pgQuery('SELECT client_id FROM orders WHERE order_id = $1', [orderId]);
    if (r.rows[0]?.client_id) model = await getClientModel(r.rows[0].client_id);
  } catch (_) { /* fall back to the default price */ }
  const p = pricePerToken(model);
  t = { ...t, cost_usd: Number((t.in_tokens * p.input + t.out_tokens * p.output).toFixed(8)) };

  const entry = {
    at: new Date().toISOString(),
    kind,
    model,
    ...t,
    ...extra,
  };
  try {
    await db.pgQuery(
      `UPDATE orders
          SET gen_cost_usd = COALESCE(gen_cost_usd, 0) + $1,
              gen_runs     = COALESCE(gen_runs, '[]'::jsonb) || $2::jsonb
        WHERE order_id = $3`,
      [t.cost_usd, JSON.stringify([entry]), orderId]
    );
    console.log(`[GEN-COST] ${orderId} ${kind}: +$${t.cost_usd.toFixed(6)} (${t.calls} calls, ${t.in_tokens}→${t.out_tokens} tok)`);
  } catch (e) {
    console.warn('[GEN-COST] could not record:', e.message);
  }
  return t;
}

module.exports = { makeMeter, recordOrderGenCost };
