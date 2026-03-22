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
        COALESCE(SUM(CASE WHEN m.created_at >= date_trunc('month', NOW()) THEN m.cost_usd END), 0)::numeric                    AS cost_this_month,
        COUNT(CASE WHEN m.sender_type='bot' AND m.created_at >= date_trunc('day', NOW()) THEN 1 END)::int                      AS ai_messages_today,
        COUNT(CASE WHEN m.sender_type='bot' AND m.created_at >= date_trunc('month', NOW()) THEN 1 END)::int                    AS ai_messages_this_month,
        COUNT(CASE WHEN m.sender_type='bot' THEN 1 END)::int                                                                   AS ai_messages_total
      FROM customers cu
      LEFT JOIN messages m ON m.phone_number=cu.phone_number ${clientId ? 'AND m.client_id=$1' : ''}
      LEFT JOIN orders   o ON o.phone_number=cu.phone_number ${clientId ? 'AND o.client_id=$1' : ''}
      WHERE TRUE ${clientFilter}
    `, params);
    let packageInfo = {};
    if (clientId) {
      const pkgRes = await db.pgQuery(
        `SELECT cc.bonus_messages, cc.overage_limit,
                COALESCE(cc.per_message_cost, p.per_message_cost, 0) AS per_message_cost,
                p.message_limit AS package_message_limit, p.name AS package_name
         FROM client_configs cc
         LEFT JOIN packages p ON p.id = cc.package_id
         WHERE cc.client_id=$1`, [clientId]
      );
      if (pkgRes.rows.length) {
        const pk = pkgRes.rows[0];
        const freeLimit = (pk.package_message_limit || 0) + (pk.bonus_messages || 0);
        const overageUsed = Math.max(0, (r.rows[0].ai_messages_this_month || 0) - freeLimit);
        packageInfo = {
          package_name: pk.package_name,
          package_message_limit: pk.package_message_limit,
          bonus_messages: pk.bonus_messages,
          overage_limit: pk.overage_limit,
          per_message_cost: pk.per_message_cost,
          free_limit: freeLimit,
          overage_used: overageUsed,
          overage_cost: (overageUsed * parseFloat(pk.per_message_cost || 0)).toFixed(6),
        };
      }
    }
    res.json({ ...r.rows[0], ...packageInfo });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = { getSummary };
