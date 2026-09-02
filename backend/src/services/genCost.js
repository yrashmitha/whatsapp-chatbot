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

// gemini-2.5-flash pricing (USD per token). Mirror of gemini.js:PRICE_*.
const PRICE_INPUT  = 0.075 / 1_000_000;
const PRICE_OUTPUT = 0.30  / 1_000_000;

/**
 * A running tally of token usage across the many model calls in one report run.
 * @returns {{ add: (usage:object|undefined)=>void, totals: {in_tokens:number,out_tokens:number,calls:number,cost_usd:number} }}
 */
function makeMeter() {
  let inTok = 0, outTok = 0, calls = 0;
  return {
    add(usage) {
      if (!usage) return;
      inTok  += usage.promptTokenCount || 0;
      // thoughtsTokenCount is billed at the output rate on 2.5 models.
      outTok += (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0);
      calls  += 1;
    },
    get totals() {
      const cost = inTok * PRICE_INPUT + outTok * PRICE_OUTPUT;
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
  const t = meter.totals;
  if (!orderId || !db.IS_PG) return t;
  if (t.calls === 0) return t;

  const entry = {
    at: new Date().toISOString(),
    kind,
    model: 'gemini-2.5-flash',
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

module.exports = { makeMeter, recordOrderGenCost, PRICE_INPUT, PRICE_OUTPUT };
