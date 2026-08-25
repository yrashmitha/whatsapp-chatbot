/**
 * @module controllers/orders.controller
 * @description Handlers for CRM order routes (list, export CSV, update status/flags/fields/notes).
 */

'use strict';

const db = require('../db');
const resolveClientId = require('../middleware/resolveClientId');
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
  try {
    const conditions = [];
    const params = [];
    if (clientId)   { params.push(clientId);        conditions.push(`o.client_id=$${params.length}`); }
    if (status)     { params.push(status);           conditions.push(`o.status=$${params.length}`); }
    if (search)     { params.push(`%${search}%`);   conditions.push(`(o.order_id ILIKE $${params.length} OR o.phone_number ILIKE $${params.length})`); }
    if (date_from)  { params.push(date_from);        conditions.push(`o.created_at >= $${params.length}::date`); }
    if (date_to)    { params.push(date_to);          conditions.push(`o.created_at < ($${params.length}::date + INTERVAL '1 day')`); }
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
  try {
    const r = await db.pgQuery(
      `SELECT
         COUNT(*) AS order_count,
         COALESCE(SUM(
           CASE
             WHEN regexp_replace(custom_fields->'payment_identified'->>'amount', '[^0-9.]', '', 'g') ~ '^[0-9]+([.][0-9]+)?$'
               THEN (regexp_replace(custom_fields->'payment_identified'->>'amount', '[^0-9.]', '', 'g'))::numeric
             ELSE COALESCE((
               SELECT SUM((item->>'price')::numeric)
               FROM jsonb_array_elements(COALESCE(custom_fields->'items', '[]'::jsonb)) AS item
             ), 0)
           END
         ), 0) AS total
       FROM orders
       WHERE client_id = $1
         AND status = ANY($2)
         AND created_at >= date_trunc('month', NOW())
         AND created_at <  date_trunc('month', NOW()) + INTERVAL '1 month'`,
      [clientId, PAID_STATUSES]
    );
    res.json({
      total: parseFloat(r.rows[0].total) || 0,
      order_count: parseInt(r.rows[0].order_count, 10) || 0,
      month: new Date().toISOString().slice(0, 7),
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
  const ALLOWED = ['pending','started','delivered','done','cancelled','payment_received','paid','complete'];
  const { status } = req.body;
  if (!status || !ALLOWED.includes(status))
    return res.status(400).json({ error: `Invalid status. Allowed: ${ALLOWED.join(', ')}` });
  try {
    await db.pgQuery(`UPDATE orders SET status=$1 WHERE order_id=$2`, [status, req.params.id]);
    res.json({ ok: true });
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

module.exports = { listOrders, exportOrders, incomeSummary, updateStatus, updateFields, updateNotes, createOrder, deleteOrder, addRemark, deleteRemark };
