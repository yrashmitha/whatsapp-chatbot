/**
 * @module controllers/orders.controller
 * @description Handlers for CRM order routes (list, export CSV, update status/flags/fields/notes).
 */

'use strict';

const db = require('../db');
const resolveClientId = require('../middleware/resolveClientId');
const { hasPermission } = require('../services/permissions');
const { creditIfPaid, TZ } = require('../services/salesCredit');
const commission = require('../services/commission');
const { generateOrderId } = require('../services/gemini');
const clientRouter = require('../services/clientRouter');

/**
 * GET /api/orders — paginated order list with optional status and search filters.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function listOrders(req, res) {
  const clientId = resolveClientId(req);
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  const status    = req.query.status    || '';
  const search    = req.query.search    || '';
  const date_from = req.query.date_from || '';
  const date_to   = req.query.date_to   || '';
  // Who closed it: a crm_users id, 'bot' for sales nobody claimed, or blank for
  // everyone.
  //
  // This is a view, not a restriction, and it stays that way for operators too.
  // Credit is stamped at payment, so a pending order has none - filtering an
  // operator's list to their own credited sales would hide every order they are
  // meant to be chasing and show them only the ones already paid. The inbox is
  // shared; what is private is the money, and that is scoped in the income
  // summary instead.
  const operator = req.query.operator || '';
  try {
    const conditions = [];
    const params = [];
    if (clientId)   { params.push(clientId);        conditions.push(`o.client_id=$${params.length}`); }
    if (status)     { params.push(status);           conditions.push(`o.status=$${params.length}`); }
    if (search)     { params.push(`%${search}%`);   conditions.push(`(o.order_id ILIKE $${params.length} OR o.phone_number ILIKE $${params.length})`); }
    if (date_from)  { params.push(date_from);        conditions.push(`o.created_at >= $${params.length}::date`); }
    if (date_to)    { params.push(date_to);          conditions.push(`o.created_at < ($${params.length}::date + INTERVAL '1 day')`); }
    if (operator === 'bot') { conditions.push(`o.credited_to IS NULL`); }
    else if (operator)      { params.push(parseInt(operator, 10)); conditions.push(`o.credited_to=$${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);  const limitIdx  = params.length;
    params.push(offset); const offsetIdx = params.length;
    const countConditions = [];
    const countParams = [];
    if (clientId)   { countParams.push(clientId);       countConditions.push(`client_id=$${countParams.length}`); }
    if (status)     { countParams.push(status);          countConditions.push(`status=$${countParams.length}`); }
    if (search)     { countParams.push(`%${search}%`);  countConditions.push(`(order_id ILIKE $${countParams.length} OR phone_number ILIKE $${countParams.length})`); }
    if (date_from)  { countParams.push(date_from);       countConditions.push(`created_at >= $${countParams.length}::date`); }
    if (date_to)    { countParams.push(date_to);         countConditions.push(`created_at < ($${countParams.length}::date + INTERVAL '1 day')`); }
    if (operator === 'bot') { countConditions.push(`credited_to IS NULL`); }
    else if (operator)      { countParams.push(parseInt(operator, 10)); countConditions.push(`credited_to=$${countParams.length}`); }
    const countWhere = countConditions.length ? `WHERE ${countConditions.join(' AND ')}` : '';
    const [rows, countRes] = await Promise.all([
      db.pgQuery(`SELECT o.*, o.phone_number AS phone, cu.name AS customer_name FROM orders o LEFT JOIN customers cu ON cu.phone_number=o.phone_number ${where} ORDER BY o.created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`, params),
      db.pgQuery(`SELECT COUNT(*) FROM orders ${countWhere}`, countParams),
    ]);
    res.json({ orders: rows.rows, total: parseInt(countRes.rows[0].count), page, limit });
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}

/**
 * GET /api/orders/export — download orders as CSV.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function exportOrders(req, res) {
  const clientId  = resolveClientId(req);
  const status    = req.query.status    || '';
  const search    = req.query.search    || '';
  const date_from = req.query.date_from || '';
  const date_to   = req.query.date_to   || '';
  try {
    const conditions = [];
    const params = [];
    if (clientId)  { params.push(clientId);       conditions.push(`o.client_id=$${params.length}`); }
    if (status)    { params.push(status);          conditions.push(`o.status=$${params.length}`); }
    if (search)    { params.push(`%${search}%`);  conditions.push(`(o.order_id ILIKE $${params.length} OR o.phone_number ILIKE $${params.length})`); }
    if (date_from) { params.push(date_from);       conditions.push(`o.created_at >= $${params.length}::date`); }
    if (date_to)   { params.push(date_to);         conditions.push(`o.created_at < ($${params.length}::date + INTERVAL '1 day')`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const r = await db.pgQuery(
      `SELECT o.order_id, o.phone_number, cu.name AS customer_name, o.status,
              o.custom_fields, o.notes, o.created_at, o.client_id
       FROM orders o LEFT JOIN customers cu ON cu.phone_number=o.phone_number
       ${where} ORDER BY o.created_at DESC`, params
    );
    // Collect all unique custom_field keys across all rows (skip internal product_id key)
    const cfKeySet = new Set();
    for (const row of r.rows) {
      const cf = typeof row.custom_fields === 'string'
        ? JSON.parse(row.custom_fields || '{}')
        : (row.custom_fields || {});
      Object.keys(cf).filter(k => k !== 'product_id').forEach(k => cfKeySet.add(k));
    }
    const cfKeys = [...cfKeySet];

    const fixedCols = ['order_id', 'phone_number', 'customer_name', 'status', 'notes', 'created_at', 'client_id'];
    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const allHeaders = [...fixedCols, ...cfKeys].map(escape).join(',');

    const dataRows = r.rows.map(row => {
      const cf = typeof row.custom_fields === 'string'
        ? JSON.parse(row.custom_fields || '{}')
        : (row.custom_fields || {});
      return [
        ...fixedCols.map(c => escape(row[c])),
        ...cfKeys.map(k => escape(cf[k])),
      ].join(',');
    });

    // UTF-8 BOM ensures Excel/Sheets renders Sinhala and other Unicode text correctly
    const BOM = '\uFEFF';
    const csv = BOM + [allHeaders, ...dataRows].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="orders-${Date.now()}.csv"`);
    res.send(csv);
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}

// Statuses that represent a confirmed payment (matches metaConversions.js's Purchase-event gate)
const PAID_STATUSES = ['payment_received', 'paid', 'delivered', 'done', 'complete'];

/**
 * GET /api/orders/income-summary — total income for the current calendar month.
 * Amount per order: custom_fields.payment_identified.amount (confirmed payment),
 * falling back to the sum of custom_fields.items[].price (selected package) when
 * no payment record was captured. Only orders in a "paid" status are counted.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function incomeSummary(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  if (!await db.hasAddon(clientId, 'income_summary')) {
    return res.status(403).json({ error: 'income_summary addon not enabled' });
  }
  // An operator sees only what they closed. The owner sees the split.
  const uid = req.user?.uid ?? null;
  if (uid && !hasPermission(req.user, 'finance.income')) {
    if (!hasPermission(req.user, 'payroll.own')) {
      return res.status(403).json({ error: 'You do not have permission to see income figures' });
    }
  }

  // The month a sale belongs to is the month it was in Sri Lanka. Colombo is
  // UTC+5:30, so a payment before 05:30 on the first falls in the previous
  // month in UTC, which on a tiered commission changes what it pays.
  const MONTH = `date_trunc('month', o.created_at AT TIME ZONE '${TZ}')
                   = date_trunc('month', (NOW() AT TIME ZONE '${TZ}'))`;

  try {
    if (uid && !hasPermission(req.user, 'finance.income')) {
      const own = await db.pgQuery(
        `SELECT COUNT(*) AS order_count,
                COALESCE(SUM(
           CASE
             WHEN regexp_replace(o.custom_fields->'payment_identified'->>'amount', '[^0-9.]', '', 'g') ~ '^[0-9]+([.][0-9]+)?$'
               THEN (regexp_replace(o.custom_fields->'payment_identified'->>'amount', '[^0-9.]', '', 'g'))::numeric
             ELSE COALESCE((
               SELECT SUM((item->>'price')::numeric)
               FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.custom_fields->'items')='array' THEN o.custom_fields->'items' ELSE '[]'::jsonb END) AS item
             ), 0)
           END
                ), 0) AS total
           FROM orders o
          WHERE o.client_id = $1 AND o.status = ANY($2)
            AND o.credited_to = $3 AND ${MONTH}`,
        [clientId, PAID_STATUSES, uid]
      );
      return res.json({
        scope: 'own',
        total: parseFloat(own.rows[0].total) || 0,
        order_count: parseInt(own.rows[0].order_count, 10) || 0,
        month: colomboMonth(),
      });
    }

    // Narrowing to one operator answers a different question: what these sales
    // brought in, and what is owed on them. The scheme prices each sale by its
    // own frozen sequence number, so the figure does not depend on which
    // filter happened to be applied when it was asked for.
    const pick = req.query.operator || '';
    if (pick) {
      const isBot = pick === 'bot';
      const sales = await db.pgQuery(
        `SELECT o.credit_seq, (
                  CASE
                    WHEN regexp_replace(o.custom_fields->'payment_identified'->>'amount', '[^0-9.]', '', 'g') ~ '^[0-9]+([.][0-9]+)?$'
                      THEN (regexp_replace(o.custom_fields->'payment_identified'->>'amount', '[^0-9.]', '', 'g'))::numeric
                    ELSE COALESCE((
                      SELECT SUM((item->>'price')::numeric)
                      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.custom_fields->'items')='array' THEN o.custom_fields->'items' ELSE '[]'::jsonb END) AS item
                    ), 0)
                  END
                ) AS amount, u.display_name
           FROM orders o
           LEFT JOIN crm_users u ON u.id = o.credited_to
          WHERE o.client_id = $1 AND o.status = ANY($2) AND ${MONTH}
            AND ${isBot ? 'o.credited_to IS NULL' : 'o.credited_to = $3'}`,
        isBot ? [clientId, PAID_STATUSES] : [clientId, PAID_STATUSES, parseInt(pick, 10)]
      );
      const rowsP = sales.rows;
      const income = rowsP.reduce((a, x) => a + (parseFloat(x.amount) || 0), 0);
      const scheme = await commission.getScheme(clientId);
      // The bot earns nobody a commission, so do not imply one by reporting 0.
      const owed = isBot ? null : commission.totalFor(scheme, rowsP).total;
      return res.json({
        scope: isBot ? 'bot' : 'operator',
        operator: isBot ? null : { user_id: parseInt(pick, 10), name: rowsP[0]?.display_name || `user ${pick}` },
        month: colomboMonth(),
        total: income,
        order_count: rowsP.length,
        commission: owed,
        commission_configured: commission.isConfigured(scheme),
      });
    }

    // The owner's view: the bot's unattended sales, each operator's, and the sum.
    const r = await db.pgQuery(
      `SELECT o.credited_to,
              u.display_name,
              COUNT(*)::int AS order_count,
              COALESCE(SUM(
           CASE
             WHEN regexp_replace(o.custom_fields->'payment_identified'->>'amount', '[^0-9.]', '', 'g') ~ '^[0-9]+([.][0-9]+)?$'
               THEN (regexp_replace(o.custom_fields->'payment_identified'->>'amount', '[^0-9.]', '', 'g'))::numeric
             ELSE COALESCE((
               SELECT SUM((item->>'price')::numeric)
               FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.custom_fields->'items')='array' THEN o.custom_fields->'items' ELSE '[]'::jsonb END) AS item
             ), 0)
           END
              ), 0) AS total
         FROM orders o
         LEFT JOIN crm_users u ON u.id = o.credited_to
        WHERE o.client_id = $1 AND o.status = ANY($2) AND ${MONTH}
        GROUP BY o.credited_to, u.display_name
        ORDER BY total DESC`,
      [clientId, PAID_STATUSES]
    );

    const num = (v) => parseFloat(v) || 0;
    const houseRow = r.rows.find((x) => x.credited_to === null);
    const operators = r.rows
      .filter((x) => x.credited_to !== null)
      .map((x) => ({
        user_id: x.credited_to,
        name: x.display_name || `user ${x.credited_to}`,
        total: num(x.total),
        order_count: x.order_count,
      }));

    // What each of them is owed on this month's sales so far.
    const scheme = await commission.getScheme(clientId);
    if (commission.isConfigured(scheme)) {
      for (const o of operators) {
        const seqs = await db.pgQuery(
          `SELECT o.credit_seq, (
              CASE
                WHEN regexp_replace(o.custom_fields->'payment_identified'->>'amount', '[^0-9.]', '', 'g') ~ '^[0-9]+([.][0-9]+)?$'
                  THEN (regexp_replace(o.custom_fields->'payment_identified'->>'amount', '[^0-9.]', '', 'g'))::numeric
                ELSE COALESCE((
                  SELECT SUM((item->>'price')::numeric)
                  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.custom_fields->'items')='array' THEN o.custom_fields->'items' ELSE '[]'::jsonb END) AS item
                ), 0)
              END
            ) AS amount
             FROM orders o
            WHERE o.client_id=$1 AND o.status = ANY($2) AND o.credited_to=$3 AND ${MONTH}`,
          [clientId, PAID_STATUSES, o.user_id]);
        o.commission = commission.totalFor(scheme, seqs.rows).total;
      }
    }

    res.json({
      scope: 'all',
      month: colomboMonth(),
      bot: { total: num(houseRow?.total), order_count: houseRow?.order_count || 0 },
      operators,
      operator_total: operators.reduce((a, o) => a + o.total, 0),
      commission_total: operators.reduce((a, o) => a + (o.commission || 0), 0),
      commission_configured: commission.isConfigured(scheme),
      total: r.rows.reduce((a, x) => a + num(x.total), 0),
      order_count: r.rows.reduce((a, x) => a + x.order_count, 0),
    });
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}

/**
 * The current month in Colombo, as YYYY-MM.
 *
 * @returns {string}
 */
function colomboMonth() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' })
    .format(new Date()).slice(0, 7);
}

/**
 * GET /api/orders/by-ad — what each ad actually produced.
 *
 * People, orders, paid orders and revenue, grouped by the ad that first brought
 * the customer in. First touch rather than last, because the question is which
 * ad produces customers, and a person who clicks a second ad on the way to
 * paying was already yours.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function ordersByAd(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const from = req.query.date_from || null;
  const to   = req.query.date_to   || null;
  try {
    const r = await db.pgQuery(
      `SELECT cu.first_ad_id AS ad_id,
              MAX(cu.first_ad_headline) AS headline,
              MAX(d.name) AS ad_name,
              MAX(d.amount_spent) AS amount_spent,
              MAX(d.effective_status) AS effective_status,
              COUNT(DISTINCT cu.phone_number)::int AS people,
              COUNT(DISTINCT o.order_id)::int      AS orders,
              COUNT(DISTINCT o.order_id) FILTER (WHERE o.status = ANY($2))::int AS paid,
              COALESCE(SUM(
                CASE WHEN o.status = ANY($2) THEN (
                  CASE
                    WHEN regexp_replace(o.custom_fields->'payment_identified'->>'amount', '[^0-9.]', '', 'g') ~ '^[0-9]+([.][0-9]+)?$'
                      THEN (regexp_replace(o.custom_fields->'payment_identified'->>'amount', '[^0-9.]', '', 'g'))::numeric
                    ELSE COALESCE((
                      SELECT SUM((item->>'price')::numeric)
                      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.custom_fields->'items')='array'
                                                     THEN o.custom_fields->'items' ELSE '[]'::jsonb END) AS item), 0)
                  END) ELSE 0 END
              ), 0) AS revenue
         FROM customers cu
         LEFT JOIN orders o
           ON o.phone_number = cu.phone_number AND o.client_id = cu.client_id
         LEFT JOIN ad_details d ON d.ad_id = cu.first_ad_id
         WHERE cu.client_id = $1
           AND ($3::date IS NULL OR cu.first_ad_at >= $3::date)
           AND ($4::date IS NULL OR cu.first_ad_at < ($4::date + INTERVAL '1 day'))
         GROUP BY cu.first_ad_id
         ORDER BY revenue DESC NULLS LAST`,
      [clientId, PAID_STATUSES, from, to]);

    const rows = r.rows.map(x => ({
      ad_id: x.ad_id,
      ad_name: x.ad_name,
      headline: x.headline,
      amount_spent: x.amount_spent,
      effective_status: x.effective_status,
      people: x.people,
      orders: x.orders,
      paid: x.paid,
      revenue: parseFloat(x.revenue) || 0,
      // The number the question is really about.
      cost_per_sale_inputs: { people: x.people, paid: x.paid },
    }));
    res.json({
      ads: rows.filter(x => x.ad_id),
      // Everyone who did not arrive through an ad we recorded: organic, or
      // from before this was captured at all.
      unattributed: rows.find(x => !x.ad_id) || null,
    });
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}

/**
 * PATCH /api/orders/:id/status — update order status.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function updateStatus(req, res) {
  // payment_identified is deliberately absent from PAID_STATUSES: a slip has
  // been seen, not banked. It must not count as income, must not freeze a
  // credit, and is the one money-adjacent status an operator may set.
  const ALLOWED = ['pending','started','payment_identified','delivered','done','cancelled','payment_received','paid','complete'];
  const { status } = req.body;
  if (!status || !ALLOWED.includes(status))
    return res.status(400).json({ error: `Invalid status. Allowed: ${ALLOWED.join(', ')}` });
  const clientId = resolveClientId(req);
  try {
    // Saying the money arrived is the owner's call, because the owner is the one
    // checking the bank. The gate is on any status that would freeze credit, not
    // just on the word "payment_received", or an operator could jump an order
    // straight to delivered and credit themselves a sale nobody had banked.
    // Already-credited orders are exempt: marking a paid order delivered is the
    // ordinary next step and belongs to whoever is doing the work.
    if (PAID_STATUSES.includes(status) && !hasPermission(req.user, 'orders.mark_paid')) {
      const seen = await db.pgQuery(
        `SELECT credited_at FROM orders WHERE order_id=$1 AND client_id=$2`,
        [req.params.id, clientId]);
      if (!seen.rows.length) return res.status(404).json({ error: 'No such order' });
      if (!seen.rows[0].credited_at) {
        return res.status(403).json({
          error: 'Only the account owner can confirm a payment, since they are the one checking the bank.',
          permission: 'orders.mark_paid',
        });
      }
    }
    await db.pgQuery(`UPDATE orders SET status=$1 WHERE order_id=$2`, [status, req.params.id]);
    res.json({ ok: true });
    // Freeze whose sale this is, once, the first time it reads as paid.
    creditIfPaid(clientId, req.params.id, status);
    // Fire CAPI Purchase event when an admin manually marks an order as paid
    if (status === 'payment_received' || status === 'paid') {
      db.pgQuery('SELECT phone_number, client_id FROM orders WHERE order_id=$1', [req.params.id])
        .then(({ rows }) => {
          if (rows.length) {
            const { fireCAPIEvent } = require('../services/metaConversions');
            fireCAPIEvent(rows[0].client_id, 'Purchase', rows[0].phone_number, { order_id: req.params.id }).catch(() => {});
          }
        }).catch(() => {});
    }
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}

/**
 * PATCH /api/orders/:id/fields — replace custom_fields JSON on an order.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function updateFields(req, res) {
  const { custom_fields } = req.body;
  if (!custom_fields || typeof custom_fields !== 'object')
    return res.status(400).json({ error: 'custom_fields object required' });
  try {
    await db.updateOrderCustomFields(req.params.id, custom_fields);
    res.json({ ok: true });
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}

/**
 * PATCH /api/orders/:id/notes — update internal notes on an order.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function updateNotes(req, res) {
  const { notes } = req.body;
  try {
    await db.pgQuery(`UPDATE orders SET notes=$1 WHERE order_id=$2`, [notes ?? null, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}

async function createOrder(req, res) {
  const clientId = resolveClientId(req);
  const { phone_number, custom_fields, notes } = req.body;
  if (!phone_number) return res.status(400).json({ error: 'phone_number required' });
  if (!custom_fields || typeof custom_fields !== 'object') return res.status(400).json({ error: 'custom_fields object required' });
  try {
    const client = clientId ? await clientRouter.getClientById(clientId) : null;
    const orderId = await generateOrderId(client);
    // Ensure customer row exists (FK constraint on orders.phone_number)
    await db.pgQuery(
      `INSERT INTO customers (phone_number, client_id) VALUES ($1, $2) ON CONFLICT (phone_number) DO NOTHING`,
      [phone_number, clientId || null]
    );
    // Update customer name if provided
    if (custom_fields.customer_name) {
      await db.pgQuery(
        `UPDATE customers SET name=$1 WHERE phone_number=$2`,
        [custom_fields.customer_name, phone_number]
      );
    }
    await db.insertOrder(orderId, phone_number, clientId || null, custom_fields);
    if (notes) {
      await db.pgQuery(`UPDATE orders SET notes=$1 WHERE order_id=$2`, [notes, orderId]);
    }
    res.json({ ok: true, order_id: orderId });
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}


/**
 * DELETE /api/orders/:id — remove an order permanently.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function deleteOrder(req, res) {
  const clientId = resolveClientId(req);
  try {
    // Scoped here as well as by orderScope: one guard failing should not be
    // enough to delete another tenant's order.
    const r = clientId
      ? await db.pgQuery('DELETE FROM orders WHERE order_id=$1 AND client_id=$2', [req.params.id, clientId])
      : await db.pgQuery('DELETE FROM orders WHERE order_id=$1', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Order not found' });
    console.log(`[ORDER] Deleted ${req.params.id} (client=${clientId || 'superadmin'})`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[ORDER] delete failed:', e.message);
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /api/orders/:id/remarks — append a remark.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function addRemark(req, res) {
  const clientId = resolveClientId(req);
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  if (text.length > 2000) return res.status(400).json({ error: 'Remark is too long (2000 characters max)' });

  const entry = JSON.stringify([{ text, ts: new Date().toISOString(), by: req.user?.username || null }]);
  try {
    const r = clientId
      ? await db.pgQuery(
          `UPDATE orders SET remarks = COALESCE(remarks, '[]'::jsonb) || $1::jsonb
            WHERE order_id=$2 AND client_id=$3 RETURNING remarks`,
          [entry, req.params.id, clientId])
      : await db.pgQuery(
          `UPDATE orders SET remarks = COALESCE(remarks, '[]'::jsonb) || $1::jsonb
            WHERE order_id=$2 RETURNING remarks`,
          [entry, req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Order not found' });
    res.json({ ok: true, remarks: r.rows[0].remarks });
  } catch (e) {
    console.error('[ORDER] addRemark failed:', e.message);
    res.status(500).json({ error: e.message });
  }
}

/**
 * DELETE /api/orders/:id/remarks/:index — remove one remark by position.
 *
 * Read then write rather than a jsonb path delete, so an index that no longer
 * exists is reported instead of silently removing nothing.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function deleteRemark(req, res) {
  const clientId = resolveClientId(req);
  const idx = parseInt(req.params.index, 10);
  if (!Number.isInteger(idx) || idx < 0) return res.status(400).json({ error: 'invalid index' });
  try {
    const sel = clientId
      ? await db.pgQuery('SELECT remarks FROM orders WHERE order_id=$1 AND client_id=$2', [req.params.id, clientId])
      : await db.pgQuery('SELECT remarks FROM orders WHERE order_id=$1', [req.params.id]);
    if (sel.rowCount === 0) return res.status(404).json({ error: 'Order not found' });

    let remarks = sel.rows[0].remarks || [];
    if (typeof remarks === 'string') { try { remarks = JSON.parse(remarks); } catch { remarks = []; } }
    if (idx >= remarks.length) return res.status(400).json({ error: 'That remark is already gone' });

    remarks.splice(idx, 1);
    const upd = clientId
      ? await db.pgQuery('UPDATE orders SET remarks=$1 WHERE order_id=$2 AND client_id=$3', [JSON.stringify(remarks), req.params.id, clientId])
      : await db.pgQuery('UPDATE orders SET remarks=$1 WHERE order_id=$2', [JSON.stringify(remarks), req.params.id]);
    if (upd.rowCount === 0) return res.status(404).json({ error: 'Order not found' });
    res.json({ ok: true, remarks });
  } catch (e) {
    console.error('[ORDER] deleteRemark failed:', e.message);
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  ordersByAd, listOrders, exportOrders, incomeSummary, updateStatus, updateFields, updateNotes, createOrder, deleteOrder, addRemark, deleteRemark };
