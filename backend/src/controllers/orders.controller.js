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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    await db.insertOrder(orderId, phone_number, clientId || null, custom_fields);
    if (notes) {
      await db.pgQuery(`UPDATE orders SET notes=$1 WHERE order_id=$2`, [notes, orderId]);
    }
    res.json({ ok: true, order_id: orderId });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = { listOrders, exportOrders, updateStatus, updateFields, updateNotes, createOrder };
