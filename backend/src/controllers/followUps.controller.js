/**
 * @module controllers/followUps.controller
 * @description The follow-up work queue, and what each approach earns.
 */

'use strict';

const db = require('../db');
const clientRouter = require('../services/clientRouter');
const resolveClientId = require('../middleware/resolveClientId');
const { sendWhatsAppMessage } = require('../services/whatsapp');
const { buildQueue, DEFAULT_SYSTEM } = require('../services/followUpQueue');
const scheduled = require('../services/scheduledFollowUps');

/**
 * GET /api/follow-ups — who to message now, and what to say.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function listFollowUps(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    res.json(await buildQueue(clientId));
  } catch (e) {
    console.error('[FOLLOW-UP] queue failed:', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

/**
 * POST /api/follow-ups/:orderId/send — send one follow-up and record it.
 *
 * Sending from here rather than copying the text elsewhere is what makes the
 * measurement honest: we know the message went out, when, and which approach it
 * used, so a reply afterwards can be credited to it.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function sendFollowUp(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  const { orderId } = req.params;
  const text = String(req.body?.message || '').trim();
  const { angle = null, temp = null, edited = false } = req.body || {};
  if (!text) return res.status(400).json({ error: 'message required' });

  try {
    const { rows } = await db.pgQuery(
      'SELECT phone_number FROM orders WHERE order_id=$1 AND client_id=$2', [orderId, clientId]);
    if (!rows.length) return res.status(404).json({ error: 'Order not found' });
    const phone = rows[0].phone_number;

    // Outside the window a free-form message is silently dropped by Meta, and
    // recording a send that never happened would poison the measurement.
    const cust = await db.pgQuery(
      'SELECT last_customer_message_at FROM customers WHERE phone_number=$1 AND client_id=$2', [phone, clientId]);
    const last = cust.rows[0]?.last_customer_message_at;
    if (last && Date.now() - new Date(last).getTime() > 24 * 36e5) {
      return res.status(409).json({ error: 'Their 24-hour window has closed — this needs an approved template' });
    }

    const client = await clientRouter.getClientById(clientId);
    const wamid = await sendWhatsAppMessage(phone, text, client);
    await db.insertMessage(phone, text, 'bot', null, clientId, null, null, wamid);
    await db.pgQuery(
      `INSERT INTO follow_up_sends (client_id, order_id, phone_number, angle, temp, message, edited)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [clientId, orderId, phone, angle, temp, text, !!edited]);

    res.json({ ok: true });
  } catch (e) {
    console.error('[FOLLOW-UP] send failed:', e.message);
    res.status(500).json({ error: e?.response?.data?.error?.message || e.message });
  }
}

/**
 * GET /api/follow-ups/stats — reply and payment rate for each approach.
 *
 * A reply is any message from the customer after the follow-up went out; a
 * payment is the order reaching a paid status afterwards. Both are derived at
 * read time, so nothing has to be kept in step by a background job.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function followUpStats(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const days = Math.min(90, parseInt(req.query.days, 10) || 30);

  try {
    const { rows } = await db.pgQuery(
      `SELECT
         COALESCE(NULLIF(LOWER(f.angle), ''), 'unlabelled') AS angle,
         COUNT(*)::int AS sent,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM messages m
            WHERE m.phone_number = f.phone_number AND m.client_id = f.client_id
              AND m.sender_type = 'user' AND m.created_at > f.sent_at))::int AS replied,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM orders o
            WHERE o.order_id = f.order_id AND o.client_id = f.client_id
              AND o.status IN ('payment_received','delivered','completed')))::int AS paid
       FROM follow_up_sends f
       WHERE f.client_id = $1 AND f.sent_at > NOW() - ($2 || ' days')::interval
       GROUP BY 1
       ORDER BY sent DESC`,
      [clientId, days]
    );

    const totals = rows.reduce((a, r) => ({
      sent: a.sent + r.sent, replied: a.replied + r.replied, paid: a.paid + r.paid,
    }), { sent: 0, replied: 0, paid: 0 });

    res.json({ days, angles: rows, totals });
  } catch (e) {
    console.error('[FOLLOW-UP] stats failed:', e.message);
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /api/follow-ups/:orderId/schedule — approve a follow-up for later.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function scheduleFollowUp(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const row = await scheduled.schedule({
      clientId,
      orderId: req.params.orderId,
      message: req.body?.message,
      sendAtLocal: req.body?.send_at,
      angle: req.body?.angle,
      temp: req.body?.temp,
      approvedBy: req.user?.username || null,
    });
    res.json({ ok: true, scheduled: row });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

/**
 * GET /api/follow-ups/scheduled — what is queued to go out.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function listScheduled(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    res.json({ items: await scheduled.listPending(clientId) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * DELETE /api/follow-ups/scheduled/:id — call one back before it goes.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function cancelScheduled(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const ok = await scheduled.cancel(clientId, parseInt(req.params.id, 10));
    if (!ok) return res.status(404).json({ error: 'Not found, or it has already gone' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /api/follow-ups/prompt — the instructions used to judge and draft.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function getPrompt(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const cfg = await db.getPluginConfig(clientId, 'follow_up_queue');
    res.json({ prompt: cfg?.prompt || '', default_prompt: DEFAULT_SYSTEM, using_default: !(cfg?.prompt || '').trim() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * PUT /api/follow-ups/prompt — replace them, or clear to go back to the default.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function savePrompt(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const prompt = String(req.body?.prompt ?? '').trim();
  try {
    const existing = await db.getPluginConfig(clientId, 'follow_up_queue');
    await db.upsertPluginConfig(clientId, 'follow_up_queue', { ...existing, prompt });
    // Every stored judgement was made under the old instructions.
    await db.pgQuery('DELETE FROM follow_up_judgements WHERE client_id=$1', [clientId]).catch(() => {});
    res.json({ ok: true, using_default: !prompt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = { listFollowUps, sendFollowUp, followUpStats, scheduleFollowUp, listScheduled, cancelScheduled, getPrompt, savePrompt };
