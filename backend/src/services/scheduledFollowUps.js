/**
 * @module services/scheduledFollowUps
 * @description Follow-ups an operator approved now, to be sent later.
 *
 * Eighteen percent of people who order and never pay said plainly that they
 * would pay later — "heta dannam", "Town ගියාම දාලා". The right reply is a
 * gentle note the next morning, and nobody is at a desk to send it. So the
 * operator approves the wording and the time while the intent is fresh, and
 * this sends it.
 *
 * A human approves every message and every time. Nothing here decides on its
 * own to chase somebody.
 *
 * The checks immediately before sending matter more than the sending. A message
 * approved yesterday can be wrong by the time it fires: they may have paid,
 * replied, or fallen outside the window where WhatsApp will carry a free-form
 * message at all. Each of those cancels rather than sends, because a stale
 * approved message is worse than no message.
 */

'use strict';

const db = require('../db');
const clientRouter = require('./clientRouter');
const { sendWhatsAppMessage } = require('./whatsapp');

/** Where the customers are, unless the client says otherwise. */
const DEFAULT_TZ = 'Asia/Colombo';

/** WhatsApp's free-form reply window. */
const WINDOW_HOURS = 24;

/** Never schedule right up against the window closing; sends are not instant. */
const WINDOW_MARGIN_MIN = 15;

/**
 * What the wall clock reads in a timezone, for a given instant.
 *
 * @param {Date}   date
 * @param {string} timeZone
 * @returns {{y:number,m:number,d:number,hh:number,mm:number}}
 */
function partsIn(date, timeZone) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: +(p.hour === '24' ? '00' : p.hour), mm: +p.minute };
}

/**
 * "YYYY-MM-DD HH:mm" as read on a clock in `timeZone`.
 *
 * @param {Date}   date
 * @param {string} timeZone
 * @returns {string}
 */
function formatLocal(date, timeZone = DEFAULT_TZ) {
  const p = partsIn(date, timeZone);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.hh)}:${pad(p.mm)}`;
}

/**
 * The instant at which a clock in `timeZone` reads the given local time.
 *
 * Solved by guessing that the local time is UTC, seeing how far that lands from
 * the target once expressed in the zone, and correcting — which stays right
 * across offsets that are not whole hours, and across daylight saving in zones
 * that have it.
 *
 * @param {string} local    - "YYYY-MM-DD HH:mm"
 * @param {string} timeZone
 * @returns {Date|null} null when the string is not a valid local time
 */
function localToUtc(local, timeZone = DEFAULT_TZ) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(local || '').trim());
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m.map(Number);
  const wanted = Date.UTC(y, mo - 1, d, hh, mm);

  let guess = new Date(wanted);
  for (let i = 0; i < 3; i++) {
    const p = partsIn(guess, timeZone);
    const got = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    const drift = wanted - got;
    if (drift === 0) break;
    guess = new Date(guess.getTime() + drift);
  }
  return Number.isNaN(guess.getTime()) ? null : guess;
}

/**
 * The client's timezone, falling back to where the customers are.
 *
 * @param {string} clientId
 * @returns {Promise<string>}
 */
async function timezoneFor(clientId) {
  try {
    const { rows } = await db.pgQuery(
      'SELECT timezone FROM client_configs WHERE client_id=$1', [clientId]);
    const tz = rows[0]?.timezone;
    if (tz) { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; }
  } catch { /* an unknown zone must not stop a send */ }
  return DEFAULT_TZ;
}

/**
 * When the free-form window shuts for this customer.
 *
 * @param {Date|string|null} lastCustomerMessageAt
 * @returns {Date|null}
 */
function windowClosesAt(lastCustomerMessageAt) {
  if (!lastCustomerMessageAt) return null;
  return new Date(new Date(lastCustomerMessageAt).getTime() + WINDOW_HOURS * 36e5);
}

/**
 * Approve a follow-up to be sent later.
 *
 * @param {Object} args
 * @param {string} args.clientId
 * @param {string} args.orderId
 * @param {string} args.message
 * @param {string} args.sendAtLocal - "YYYY-MM-DD HH:mm" in the client's timezone
 * @param {string} [args.angle]
 * @param {string} [args.temp]
 * @param {string} [args.approvedBy]
 * @returns {Promise<Object>} the stored row
 */
async function schedule({ clientId, orderId, message, sendAtLocal, angle, temp, approvedBy }) {
  const text = String(message || '').trim();
  if (!text) throw Object.assign(new Error('A message is required'), { statusCode: 400 });

  const { rows } = await db.pgQuery(
    `SELECT o.phone_number, o.status, c.last_customer_message_at
       FROM orders o LEFT JOIN customers c
         ON c.phone_number = o.phone_number AND c.client_id = o.client_id
      WHERE o.order_id = $1 AND o.client_id = $2`, [orderId, clientId]);
  if (!rows.length) throw Object.assign(new Error('Order not found'), { statusCode: 404 });

  const { phone_number: phone, status, last_customer_message_at: lastIn } = rows[0];
  if (status !== 'pending') {
    throw Object.assign(new Error('That order is no longer pending'), { statusCode: 409 });
  }

  const tz = await timezoneFor(clientId);
  const when = localToUtc(sendAtLocal, tz);
  if (!when) throw Object.assign(new Error('Could not read that date and time'), { statusCode: 400 });

  if (when.getTime() < Date.now() + 60_000) {
    throw Object.assign(new Error('Pick a time at least a minute from now'), { statusCode: 400 });
  }
  const closes = windowClosesAt(lastIn);
  if (closes && when.getTime() > closes.getTime() - WINDOW_MARGIN_MIN * 60_000) {
    throw Object.assign(new Error(
      `Their window closes at ${formatLocal(closes, tz)}. Pick a time before that, or the message will not reach them.`
    ), { statusCode: 409 });
  }

  // One pending schedule each: a busy afternoon should not queue three
  // reminders at the same person.
  const existing = await db.pgQuery(
    `SELECT id FROM scheduled_follow_ups
      WHERE client_id=$1 AND phone_number=$2 AND status='pending'`, [clientId, phone]);
  if (existing.rows.length) {
    throw Object.assign(new Error('There is already a follow-up waiting to go to this customer'), { statusCode: 409 });
  }

  const ins = await db.pgQuery(
    `INSERT INTO scheduled_follow_ups
       (client_id, order_id, phone_number, message, angle, temp, send_at, approved_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [clientId, orderId, phone, text, angle || null, temp || null, when.toISOString(), approvedBy || null]);

  console.log(`[SCHEDULED] ${clientId}/${orderId} queued for ${formatLocal(when, tz)} (${tz})`);
  return ins.rows[0];
}

/**
 * Drop a pending schedule.
 *
 * @param {string} clientId
 * @param {number} id
 * @param {string} [reason]
 * @returns {Promise<boolean>} whether one was cancelled
 */
async function cancel(clientId, id, reason = 'cancelled by operator') {
  const r = await db.pgQuery(
    `UPDATE scheduled_follow_ups SET status='cancelled', outcome=$3, resolved_at=NOW()
      WHERE id=$1 AND client_id=$2 AND status='pending'`, [id, clientId, reason]);
  return r.rowCount > 0;
}

/**
 * Everything still waiting to go out for a client.
 *
 * @param {string} clientId
 * @returns {Promise<Array<Object>>}
 */
async function listPending(clientId) {
  const tz = await timezoneFor(clientId);
  const { rows } = await db.pgQuery(
    `SELECT s.*, c.name
       FROM scheduled_follow_ups s
       LEFT JOIN customers c ON c.phone_number = s.phone_number AND c.client_id = s.client_id
      WHERE s.client_id = $1 AND s.status = 'pending'
      ORDER BY s.send_at ASC`, [clientId]);
  return rows.map(r => ({ ...r, send_at_local: formatLocal(new Date(r.send_at), tz), timezone: tz }));
}

/**
 * Send everything that has come due, checking first that it still makes sense.
 *
 * @returns {Promise<{sent: number, cancelled: number}>}
 */
async function runDue() {
  const { rows: due } = await db.pgQuery(
    `SELECT * FROM scheduled_follow_ups
      WHERE status='pending' AND send_at <= NOW()
      ORDER BY send_at ASC LIMIT 50`);
  if (!due.length) return { sent: 0, cancelled: 0 };

  let sent = 0, cancelled = 0;
  for (const job of due) {
    const stop = async (outcome) => {
      cancelled++;
      await db.pgQuery(
        `UPDATE scheduled_follow_ups SET status='cancelled', outcome=$2, resolved_at=NOW() WHERE id=$1`,
        [job.id, outcome]);
      console.log(`[SCHEDULED] ${job.order_id} not sent: ${outcome}`);
    };

    try {
      const { rows } = await db.pgQuery(
        `SELECT o.status, c.last_customer_message_at
           FROM orders o LEFT JOIN customers c
             ON c.phone_number = o.phone_number AND c.client_id = o.client_id
          WHERE o.order_id = $1 AND o.client_id = $2`, [job.order_id, job.client_id]);
      if (!rows.length) { await stop('order no longer exists'); continue; }
      const { status, last_customer_message_at: lastIn } = rows[0];

      // Asking for money somebody has already sent is the worst outcome here.
      if (status !== 'pending') { await stop(`order became ${status}`); continue; }

      // If they wrote back, whatever was approved may no longer fit.
      if (lastIn && new Date(lastIn) > new Date(job.created_at)) {
        await stop('customer replied — needs a fresh look'); continue;
      }

      // Outside the window Meta drops it silently, and we would record a send
      // that never happened.
      const closes = windowClosesAt(lastIn);
      if (closes && Date.now() > closes.getTime()) { await stop('window closed before it could go'); continue; }

      // Somebody already spoke to them since this was approved.
      const chased = await db.pgQuery(
        `SELECT 1 FROM messages
          WHERE phone_number=$1 AND client_id=$2 AND sender_type='bot' AND created_at > $3 LIMIT 1`,
        [job.phone_number, job.client_id, job.created_at]);
      if (chased.rows.length) { await stop('already followed up by hand'); continue; }

      const client = await clientRouter.getClientById(job.client_id);
      const wamid = await sendWhatsAppMessage(job.phone_number, job.message, client);
      await db.insertMessage(job.phone_number, job.message, 'bot', null, job.client_id, null, null, wamid);
      await db.pgQuery(
        `INSERT INTO follow_up_sends (client_id, order_id, phone_number, angle, temp, message, edited)
         VALUES ($1,$2,$3,$4,$5,$6,FALSE)`,
        [job.client_id, job.order_id, job.phone_number, job.angle, job.temp, job.message]);
      await db.pgQuery(
        `UPDATE scheduled_follow_ups SET status='sent', resolved_at=NOW() WHERE id=$1`, [job.id]);
      sent++;
      console.log(`[SCHEDULED] Sent ${job.order_id} to ${job.phone_number}`);
    } catch (e) {
      // A failure now should not silently vanish, and should not be retried
      // forever either — the window is probably gone by the next tick anyway.
      await db.pgQuery(
        `UPDATE scheduled_follow_ups SET status='failed', outcome=$2, resolved_at=NOW() WHERE id=$1`,
        [job.id, e.message.slice(0, 200)]).catch(() => {});
      console.error(`[SCHEDULED] ${job.order_id} failed:`, e.message);
    }
  }
  return { sent, cancelled };
}

module.exports = {
  schedule, cancel, listPending, runDue,
  localToUtc, formatLocal, timezoneFor, windowClosesAt,
  DEFAULT_TZ, WINDOW_HOURS, WINDOW_MARGIN_MIN,
};
