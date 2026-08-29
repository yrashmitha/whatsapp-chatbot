/**
 * @module services/followUpReminders
 * @description A day an operator pinned to a chat, because the customer named one.
 *
 * "heta dannam", "Monday", "machine eken" — the customer says when they'll pay,
 * and by then their 24-hour window has closed and they have dropped off the
 * auto queue ({@link module:services/followUpQueue}). A reminder is the operator
 * saying "put this person back in front of me on that date". It never sends on
 * its own; it only resurfaces them on the Follow-ups screen, with a suggested
 * draft, on the day.
 *
 * One pending reminder per order. Re-setting the date on the same order updates
 * it rather than stacking a second.
 */

'use strict';

const db = require('../db');
const { timezoneFor } = require('./scheduledFollowUps');
const { draftForOrder } = require('./followUpQueue');

/** The calendar day it is right now on a clock in `timeZone` ("YYYY-MM-DD"). */
function todayLocal(timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * Pin (or re-pin) a reminder to an order.
 *
 * @param {Object} args
 * @param {string} args.clientId
 * @param {string} args.orderId
 * @param {string} args.remindOn      - "YYYY-MM-DD", the client-local day
 * @param {string} [args.note]
 * @param {number} [args.createdByUid]
 * @returns {Promise<Object>} the stored row
 */
async function create({ clientId, orderId, remindOn, note, createdByUid }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(remindOn || '').trim())) {
    throw Object.assign(new Error('A date (YYYY-MM-DD) is required'), { statusCode: 400 });
  }
  const { rows } = await db.pgQuery(
    'SELECT phone_number, status FROM orders WHERE order_id=$1 AND client_id=$2', [orderId, clientId]);
  if (!rows.length) throw Object.assign(new Error('Order not found'), { statusCode: 404 });
  if (rows[0].status !== 'pending') {
    throw Object.assign(new Error('That order is no longer pending'), { statusCode: 409 });
  }
  const tz = await timezoneFor(clientId);
  if (remindOn < todayLocal(tz)) {
    throw Object.assign(new Error('Pick today or a future date'), { statusCode: 400 });
  }
  const phone = rows[0].phone_number;

  const existing = await db.pgQuery(
    `SELECT id FROM follow_up_reminders WHERE client_id=$1 AND order_id=$2 AND status='pending'`,
    [clientId, orderId]);
  const ret = `RETURNING id, order_id, note, to_char(remind_on,'YYYY-MM-DD') AS remind_on, status`;
  if (existing.rows.length) {
    const upd = await db.pgQuery(
      `UPDATE follow_up_reminders
          SET remind_on=$3, note=$4, draft=NULL, draft_at=NULL, created_by_uid=$5, created_at=NOW()
        WHERE id=$1 AND client_id=$2 ${ret}`,
      [existing.rows[0].id, clientId, remindOn, note || null, createdByUid ?? null]);
    return upd.rows[0];
  }
  const ins = await db.pgQuery(
    `INSERT INTO follow_up_reminders (client_id, order_id, phone_number, remind_on, note, created_by_uid)
     VALUES ($1,$2,$3,$4,$5,$6) ${ret}`,
    [clientId, orderId, phone, remindOn, note || null, createdByUid ?? null]);
  return ins.rows[0];
}

/**
 * The pending reminder on an order, if any — so the chat button can show and
 * pre-fill it.
 *
 * @param {string} clientId
 * @param {string} orderId
 * @returns {Promise<Object|null>}
 */
async function forOrder(clientId, orderId) {
  const { rows } = await db.pgQuery(
    `SELECT id, to_char(remind_on,'YYYY-MM-DD') AS remind_on, note FROM follow_up_reminders
      WHERE client_id=$1 AND order_id=$2 AND status='pending' LIMIT 1`, [clientId, orderId]);
  return rows[0] || null;
}

/**
 * Every open reminder for a client, due ones first, each with the facts the
 * screen needs. A due reminder with no draft yet gets one now.
 *
 * @param {string} clientId
 * @returns {Promise<Array<Object>>}
 */
async function listOpen(clientId) {
  const tz = await timezoneFor(clientId);
  const today = todayLocal(tz);

  const { rows } = await db.pgQuery(
    `SELECT r.id, r.order_id, r.phone_number, r.note, r.draft,
            to_char(r.remind_on,'YYYY-MM-DD') AS remind_on,
            o.status                    AS order_status,
            o.custom_fields,
            c.name,
            c.last_customer_message_at,
            EXTRACT(EPOCH FROM (NOW() - c.last_customer_message_at)) / 3600 AS hours_since_in,
            lin.message_text            AS last_in_text
       FROM follow_up_reminders r
       JOIN orders o    ON o.order_id = r.order_id AND o.client_id = r.client_id
       LEFT JOIN customers c ON c.phone_number = r.phone_number AND c.client_id = r.client_id
       LEFT JOIN LATERAL (
         SELECT message_text FROM messages m
          WHERE m.phone_number = r.phone_number AND m.client_id = r.client_id
            AND m.sender_type = 'user'
          ORDER BY m.id DESC LIMIT 1
       ) lin ON TRUE
      WHERE r.client_id = $1 AND r.status = 'pending'
      ORDER BY r.remind_on ASC, r.created_at ASC`,
    [clientId]);

  // An order that has since been paid or cancelled resolves itself.
  const stale = rows.filter(r => r.order_status !== 'pending').map(r => r.id);
  if (stale.length) {
    await db.pgQuery(
      `UPDATE follow_up_reminders SET status='done', resolved_at=NOW() WHERE id = ANY($1)`, [stale]);
  }
  const open = rows.filter(r => r.order_status === 'pending');

  const out = [];
  for (const r of open) {
    const due = String(r.remind_on).slice(0, 10) <= today;
    const cf = r.custom_fields && typeof r.custom_fields === 'object' ? r.custom_fields : {};
    let draft = r.draft;

    // Draft the suggestion when it first comes due (and only once).
    if (due && !draft) {
      try {
        const d = await draftForOrder(clientId, r.order_id);
        if (d && d.draft) {
          draft = d.draft;
          await db.pgQuery(
            `UPDATE follow_up_reminders SET draft=$2, draft_at=NOW() WHERE id=$1`, [r.id, draft]);
        }
      } catch (e) {
        console.warn(`[REMINDER] draft failed for ${r.order_id}:`, e.message);
      }
    }

    out.push({
      id:            r.id,
      orderId:       r.order_id,
      phone:         r.phone_number,
      name:          r.name || null,
      note:          r.note || '',
      remindOnLocal: String(r.remind_on).slice(0, 10),
      due,
      package:       cf.package || cf.product_id || null,
      lastFromThem:  (r.last_in_text || '').slice(0, 400),
      windowOpen:    r.hours_since_in != null && Number(r.hours_since_in) < 24,
      draft:         draft || '',
      timezone:      tz,
    });
  }
  return out;
}

/**
 * Close a reminder.
 *
 * @param {string} clientId
 * @param {number} id
 * @param {'done'|'dismissed'} status
 * @returns {Promise<boolean>}
 */
async function resolve(clientId, id, status = 'done') {
  const s = status === 'dismissed' ? 'dismissed' : 'done';
  const r = await db.pgQuery(
    `UPDATE follow_up_reminders SET status=$3, resolved_at=NOW()
      WHERE id=$1 AND client_id=$2 AND status='pending'`, [id, clientId, s]);
  return r.rowCount > 0;
}

/**
 * Close any pending reminder on an order — called when the order is paid or a
 * follow-up goes out by hand, so the screen does not keep nagging.
 *
 * @param {string} clientId
 * @param {string} orderId
 * @returns {Promise<void>}
 */
async function autoResolveForOrder(clientId, orderId) {
  await db.pgQuery(
    `UPDATE follow_up_reminders SET status='done', resolved_at=NOW()
      WHERE client_id=$1 AND order_id=$2 AND status='pending'`, [clientId, orderId]).catch(() => {});
}

module.exports = { create, forOrder, listOpen, resolve, autoResolveForOrder };
