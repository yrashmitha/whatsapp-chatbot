/**
 * @module controllers/strategy.controller
 * @description Results of the two-prompt-strategy test: how each arm is doing.
 *
 * Counts only. Each customer was given an arm on arrival, in alternation, so
 * the two groups see the same ads, hours and days; what this cannot do is say
 * that a small difference is real, so the page shows the numbers and the group
 * sizes and leaves the judgement to the reader.
 */

'use strict';

const db = require('../db');
const resolveClientId = require('../middleware/resolveClientId');

/** Same set orders.controller.js treats as paid. */
const PAID_STATUSES = ['payment_received', 'paid', 'delivered', 'done', 'complete'];

/**
 * GET /api/strategy-results — per strategy: chats started, chats that really
 * talked (3+ customer messages), chats with an order, chats with a paid order.
 *
 * Only customers assigned by the split are counted (never test sessions, and
 * never customers who pre-date it). An order counts if placed after the
 * customer was assigned.
 */
async function results(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const { rows } = await db.pgQuery(
      `SELECT cu.prompt_strategy AS strategy,
              COUNT(*)::int AS chats,
              COUNT(*) FILTER (WHERE (
                SELECT COUNT(*) FROM messages m
                 WHERE m.phone_number = cu.phone_number AND m.client_id = cu.client_id
                   AND m.sender_type = 'user') >= 3)::int AS engaged,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM orders o
                 WHERE o.phone_number = cu.phone_number AND o.client_id = cu.client_id
                   AND o.status <> 'cancelled' AND o.created_at >= cu.prompt_strategy_at))::int AS with_order,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM orders o
                 WHERE o.phone_number = cu.phone_number AND o.client_id = cu.client_id
                   AND o.status = ANY($2) AND o.created_at >= cu.prompt_strategy_at))::int AS paid,
              MIN(cu.prompt_strategy_at) AS since
         FROM customers cu
        WHERE cu.client_id = $1 AND cu.prompt_strategy IS NOT NULL
          AND cu.phone_number NOT LIKE 'web:%'
        GROUP BY cu.prompt_strategy
        ORDER BY cu.prompt_strategy`,
      [clientId, PAID_STATUSES]);
    const byArm = { A: null, B: null };
    for (const r of rows) byArm[r.strategy] = r;
    const empty = (s) => ({ strategy: s, chats: 0, engaged: 0, with_order: 0, paid: 0, since: null });
    res.json({ A: byArm.A || empty('A'), B: byArm.B || empty('B') });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = { results };
