/**
 * @module controllers/customers.controller
 * @description Handlers for CRM customer routes (list, messages, mark-read,
 * delete messages, delete customer, AI mode, send message).
 */

'use strict';

const axios        = require('axios');
const db           = require('../db');
const clientRouter = require('../services/clientRouter');
const { sendWhatsAppMessage, waToken, waPhoneId } = require('../services/whatsapp');
const { chatSessions } = require('../workers/sessionManager');
const resolveClientId  = require('../middleware/resolveClientId');
const ownership        = require('../services/chatOwnership');
const { hasPermission } = require('../services/permissions');

/**
 * GET /api/customers — paginated customer list with unread badge counts.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function listCustomers(req, res) {
  const clientId = resolveClientId(req);
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const search = req.query.search || '';
  const offset = (page - 1) * limit;
  try {
    const where = clientId
      ? `WHERE cu.client_id=$1 ${search ? "AND (cu.phone_number ILIKE $4 OR cu.name ILIKE $4)" : ''}`
      : `WHERE 1=1 ${search ? "AND (cu.phone_number ILIKE $3 OR cu.name ILIKE $3)" : ''}`;
    const params = clientId
      ? [clientId, limit, offset, ...(search ? [`%${search}%`] : [])]
      : [limit, offset, ...(search ? [`%${search}%`] : [])];
    const q = `
      SELECT cu.phone_number, cu.phone_number AS phone, cu.name, cu.client_id, cu.updated_at,
             COUNT(DISTINCT m.id) AS message_count,
             COUNT(DISTINCT o.id) AS order_count,
             cu.last_customer_message_at AS last_message_at,
             GREATEST(cu.last_customer_message_at, MAX(m.created_at)) AS last_activity_at,
             cu.needs_attention,
             BOOL_OR(m.media_type = 'image') AS has_image,
             BOOL_OR(m.media_type IN ('pdf', 'document', 'audio', 'voice')) AS has_document,
             (SELECT status FROM orders o2 WHERE o2.phone_number=cu.phone_number AND o2.client_id=cu.client_id ORDER BY o2.created_at DESC LIMIT 1) AS latest_order_status,
             (SELECT COUNT(*) FROM messages m2
              WHERE m2.phone_number = cu.phone_number
                AND m2.client_id    = cu.client_id
                AND m2.sender_type  = 'user'
                AND m2.created_at   > COALESCE(cu.last_read_at, '1970-01-01T00:00:00Z')
             ) AS unread_count
      FROM customers cu
      LEFT JOIN messages m ON m.phone_number=cu.phone_number AND m.client_id=cu.client_id
      LEFT JOIN orders   o ON o.phone_number=cu.phone_number AND o.client_id=cu.client_id
      ${where}
      GROUP BY cu.phone_number, cu.name, cu.client_id, cu.updated_at, cu.last_read_at, cu.last_customer_message_at, cu.needs_attention
      ORDER BY GREATEST(cu.last_customer_message_at, MAX(m.created_at)) DESC NULLS LAST
      LIMIT ${clientId ? '$2' : '$1'} OFFSET ${clientId ? '$3' : '$2'}`;
    const countQ = clientId
      ? `SELECT COUNT(*) FROM customers cu ${search ? "WHERE client_id=$1 AND (phone_number ILIKE $2 OR name ILIKE $2)" : "WHERE client_id=$1"}`
      : `SELECT COUNT(*) FROM customers cu ${search ? "WHERE (phone_number ILIKE $1 OR name ILIKE $1)" : ''}`;
    const countParams = clientId ? [clientId, ...(search ? [`%${search}%`] : [])] : (search ? [`%${search}%`] : []);
    const [rows, countRes] = await Promise.all([db.pgQuery(q, params), db.pgQuery(countQ, countParams)]);
    res.json({ customers: rows.rows, total: parseInt(countRes.rows[0].count), page, limit });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * GET /api/messages/:phone — cursor-based lazy load of messages for a phone number.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function getMessages(req, res) {
  const clientId = resolveClientId(req);
  const { phone } = req.params;
  const limit = Math.min(100, parseInt(req.query.limit) || 50);
  const before = req.query.before; // ISO timestamp
  try {
    const params = before
      ? (clientId ? [phone, clientId, before, limit] : [phone, before, limit])
      : (clientId ? [phone, clientId, limit] : [phone, limit]);
    const q = `
      SELECT id, phone_number, message_text, sender_type, created_at, cost_usd, media_type, media_url, wamid, is_deleted,
             delivery_status, delivered_at, read_at, error_code, error_message, interactive, extracted, sent_by
      FROM messages
      WHERE phone_number=$1 ${clientId ? 'AND client_id=$2' : ''}
      ${before ? `AND created_at < ${clientId ? '$3' : '$2'}` : ''}
      ORDER BY created_at DESC
      LIMIT ${before ? (clientId ? '$4' : '$3') : (clientId ? '$3' : '$2')}`;
    const r = await db.pgQuery(q, params);
    const msgs = r.rows.reverse(); // oldest first

    // Documents are the paid deliverable. Someone without the permission still
    // sees that a file was sent and when, which is what they need to answer
    // "did you get it?", but does not get a link they can open.
    if (!hasPermission(req.user, 'chat.view_documents')) {
      for (const m of msgs) {
        if (m.media_type === 'pdf' || m.media_type === 'document') {
          m.media_url = null;
          m.media_restricted = true;
        }
      }
    }
    res.json({ messages: msgs, hasMore: msgs.length === limit });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * POST /api/send — send a WhatsApp text or image message from the CRM.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function sendMessage(req, res) {
  const clientId = resolveClientId(req);
  const { phone, message, type = 'text', mediaUrl } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'phone and message required' });
  try {
    const client = clientId ? await clientRouter.getClientById(clientId) : null;

    // Check 24-hour window — warn admin if window may be closed
    const custRow = await db.pgQuery(
      'SELECT last_customer_message_at FROM customers WHERE phone_number=$1 AND client_id=$2',
      [phone, clientId]
    );
    const lastMsg = custRow.rows[0]?.last_customer_message_at;
    const windowOpen = !lastMsg || (Date.now() - new Date(lastMsg).getTime()) < 23 * 36e5;

    // Clear attention flag whenever the owner manually replies
    await db.pgQuery(
      `UPDATE customers SET needs_attention=FALSE WHERE phone_number=$1 AND client_id=$2`,
      [phone, clientId]
    ).catch(() => {});

    if (type === 'text') {
      const wamid = await sendWhatsAppMessage(phone, message, client);
      await db.insertMessage(phone, message, 'bot', null, clientId, null, null, wamid, null, { sentBy: req.user?.uid ?? null });
    } else if (type === 'image' && mediaUrl) {
      const imgResp = await axios.post(
        `https://graph.facebook.com/v18.0/${waPhoneId(client)}/messages`,
        { messaging_product: 'whatsapp', to: phone, type: 'image', image: { link: mediaUrl, caption: message } },
        { headers: { Authorization: `Bearer ${waToken(client)}`, 'Content-Type': 'application/json' } }
      );
      const wamid = imgResp.data?.messages?.[0]?.id || null;
      await db.insertMessage(phone, `[Image] ${message}`, 'bot', null, clientId, 'image', mediaUrl, wamid, null, { sentBy: req.user?.uid ?? null });
    }
    res.json({ ok: true, window_warning: !windowOpen });
  } catch (e) { res.status(500).json({ error: e?.response?.data?.error?.message || e.message }); }
}

/**
 * DELETE /api/customers/:phone/messages — delete all messages for a phone number.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function deleteCustomerMessages(req, res) {
  try {
    const phone = req.params.phone;
    for (const key of chatSessions.keys()) { if (key.endsWith(`:${phone}`)) chatSessions.delete(key); }
    await db.pgQuery(`DELETE FROM messages WHERE phone_number=$1`, [phone]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * DELETE /api/messages/:id — soft-delete a single message.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function deleteMessage(req, res) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid message id' });
  const clientId = resolveClientId(req);
  try {
    const deleted = await db.deleteMessage(id, clientId);
    if (!deleted) return res.status(404).json({ error: 'Message not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * DELETE /api/customers/:phone — delete a customer and all related data.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function deleteCustomer(req, res) {
  try {
    const phone = req.params.phone;
    const clientId = req.user?.clientId || null;
    for (const key of chatSessions.keys()) { if (key.endsWith(`:${phone}`)) chatSessions.delete(key); }
    await db.deleteCustomer(phone, clientId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * POST /api/customers/:phone/mark-read — reset unread message badge.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function markRead(req, res) {
  const clientId = resolveClientId(req);
  const { phone } = req.params;
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    await db.pgQuery(
      `UPDATE customers SET last_read_at = NOW() WHERE phone_number = $1 AND client_id = $2`,
      [phone, clientId]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * GET /api/customers/:phone/ai-mode — get AI enabled flag for a customer.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function getAiMode(req, res) {
  const clientId = resolveClientId(req);
  const { phone } = req.params;
  try {
    const enabled = await db.getCustomerAiEnabled(phone, clientId);
    res.json({ ai_enabled: enabled });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * PATCH /api/customers/:phone/ai-mode — enable or disable AI for a customer.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function setAiMode(req, res) {
  const clientId = resolveClientId(req);
  const { phone } = req.params;
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled (boolean) required' });
  try {
    await db.setCustomerAiMode(phone, clientId, enabled);
    if (!enabled) chatSessions.delete(`${clientId}:${phone}`);
    res.json({ ok: true, ai_enabled: enabled });
  } catch (e) { res.status(500).json({ error: e.message }); }
}


/**
 * POST /api/customers/:phone/claim - take this chat over from the bot.
 *
 * Silences the bot for this customer and puts the operator's name on the chat.
 * Both halves matter: the first is what lets them reply without being talked
 * over, the second is what a sale is later credited from.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function claimChat(req, res) {
  const clientId = resolveClientId(req);
  const { phone } = req.params;
  // The owner's shared login has no uid, so there is nobody to credit. Let them
  // take chats over - they run the business - but say plainly that it does not
  // attribute, rather than silently recording a claim with no name on it.
  if (!req.user?.uid) {
    return res.status(400).json({
      error: 'Claiming a chat needs a personal login. The shared client login cannot be credited with a sale.',
    });
  }
  try {
    const result = await ownership.claim(clientId, phone, req.user.uid);
    chatSessions.delete(`${clientId}:${phone}`);
    res.json({ ok: true, ai_enabled: false, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * POST /api/customers/:phone/release - hand this chat back to the bot.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function releaseChat(req, res) {
  const clientId = resolveClientId(req);
  const { phone } = req.params;
  try {
    const was = await ownership.release(clientId, phone, req.user?.uid ?? null);
    res.json({ ok: true, ai_enabled: true, was_owned: was });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * GET /api/clients — list all active clients (superadmin only).
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function listClients(req, res) {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const r = await db.pgQuery(`SELECT c.id AS client_id, c.name, c.type, c.active, cc.brand_name, cc.brand_color FROM clients c LEFT JOIN client_configs cc ON cc.client_id=c.id WHERE c.active=TRUE ORDER BY c.name`);
    res.json({ clients: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = {
  listCustomers,
  getMessages,
  sendMessage,
  deleteCustomerMessages,
  deleteMessage,
  deleteCustomer,
  markRead,
  getAiMode,
  setAiMode,
  claimChat,
  releaseChat,
  listClients,
};
