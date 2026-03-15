/**
 * @module controllers/orders.controller
 * @description Handlers for CRM order routes (list, export CSV, update status/flags/fields/notes).
 */

'use strict';

const db = require('../db');
const resolveClientId = require('../middleware/resolveClientId');

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
  const status = req.query.status || '';
  const search = req.query.search || '';
  try {
    const conditions = [];
    const params = [];
    if (clientId) { params.push(clientId); conditions.push(`o.client_id=$${params.length}`); }
    if (status)   { params.push(status);   conditions.push(`o.status=$${params.length}`); }
    if (search)   { params.push(`%${search}%`); conditions.push(`(o.order_id ILIKE $${params.length} OR o.phone_number ILIKE $${params.length})`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);  const limitIdx  = params.length;
    params.push(offset); const offsetIdx = params.length;
    const countConditions = [];
    const countParams = [];
    if (clientId) { countParams.push(clientId); countConditions.push(`client_id=$${countParams.length}`); }
    if (status)   { countParams.push(status);   countConditions.push(`status=$${countParams.length}`); }
    if (search)   { countParams.push(`%${search}%`); countConditions.push(`(order_id ILIKE $${countParams.length} OR phone_number ILIKE $${countParams.length})`); }
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
  const clientId = resolveClientId(req);
  try {
    const where = clientId ? 'WHERE o.client_id=$1' : '';
    const params = clientId ? [clientId] : [];
    const r = await db.pgQuery(
      `SELECT o.order_id, o.phone_number, cu.name AS customer_name, o.package, o.status,
              o.birth_date, o.birth_time, o.birth_city, o.problems,
              o.horoscope_received, o.receipt_received, o.created_at, o.client_id
       FROM orders o LEFT JOIN customers cu ON cu.phone_number=o.phone_number
       ${where} ORDER BY o.created_at DESC`, params
    );
    const cols = ['order_id','phone_number','customer_name','package','status','birth_date','birth_time','birth_city','problems','horoscope_received','receipt_received','created_at','client_id'];
    const csv  = [cols.join(','), ...r.rows.map(row =>
      cols.map(c => `"${String(row[c] ?? '').replace(/"/g, '""')}"`).join(',')
    )].join('\n');
    res.setHeader('Content-Type', 'text/csv');
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
  try {
    await db.pgQuery(`UPDATE orders SET status=$1 WHERE order_id=$2`, [req.body.status, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * PATCH /api/orders/:id/flags — update horoscope_received / receipt_received flags.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function updateFlags(req, res) {
  const { horoscope_received, receipt_received } = req.body;
  try {
    const sets = [], params = [];
    if (horoscope_received !== undefined) { params.push(horoscope_received); sets.push(`horoscope_received=$${params.length}`); }
    if (receipt_received   !== undefined) { params.push(receipt_received);   sets.push(`receipt_received=$${params.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(req.params.id);
    await db.pgQuery(`UPDATE orders SET ${sets.join(',')} WHERE order_id=$${params.length}`, params);
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

module.exports = { listOrders, exportOrders, updateStatus, updateFlags, updateFields, updateNotes };
