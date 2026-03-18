'use strict';

const db = require('../db');
const resolveClientId = require('../middleware/resolveClientId');

async function getSummary(req, res) {
  const clientId = resolveClientId(req);
  try {
    const params = clientId ? [clientId] : [];
    const clientFilter = clientId ? `AND cu.client_id=$1` : '';
    const r = await db.pgQuery(`
      SELECT
        COUNT(DISTINCT CASE WHEN m.created_at >= date_trunc('day', NOW()) AND m.sender_type='user' THEN m.phone_number END)::int  AS new_chats_today,
        COUNT(DISTINCT CASE WHEN o.created_at >= date_trunc('day', NOW()) THEN o.id END)::int                                    AS orders_today,
        COUNT(DISTINCT CASE WHEN o.created_at >= date_trunc('month', NOW()) THEN o.id END)::int                                 AS orders_this_month,
        COUNT(DISTINCT o.id)::int                                                                                               AS orders_total,
        COUNT(DISTINCT CASE WHEN o.status IN ('pending','started') THEN o.id END)::int                                          AS open_orders,
        COUNT(DISTINCT cu.phone_number)::int                                                                                    AS total_customers,
        COALESCE(SUM(CASE WHEN m.created_at >= date_trunc('day', NOW()) THEN m.cost_usd END), 0)::numeric                       AS cost_today,
        COALESCE(SUM(CASE WHEN m.created_at >= date_trunc('month', NOW()) THEN m.cost_usd END), 0)::numeric                    AS cost_this_month
      FROM customers cu
      LEFT JOIN messages m ON m.phone_number=cu.phone_number ${clientId ? 'AND m.client_id=$1' : ''}
      LEFT JOIN orders   o ON o.phone_number=cu.phone_number ${clientId ? 'AND o.client_id=$1' : ''}
      WHERE TRUE ${clientFilter}
    `, params);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = { getSummary };
