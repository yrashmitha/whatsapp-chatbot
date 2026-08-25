/**
 * @module services/salesCredit
 * @description Deciding, once, whose sale a paid order was.
 *
 * Credit is frozen at the moment payment is received and never recomputed.
 * Reassigning a chat next week must not rewrite last month's payroll, and a
 * commission that changes when nobody touched it is one nobody can check.
 *
 * What is stored is the formula's inputs, never a computed commission. pj's
 * scheme steps the rate up after N sales in a month and applies the higher rate
 * from N+1 onward, so the position of a sale within its month decides what it
 * pays. That position is stamped here, at the moment it is unambiguous, rather
 * than counted later when a correction elsewhere could shift it.
 */

'use strict';

const db = require('../db');
const ownership = require('./chatOwnership');

/**
 * The month a sale belongs to is the month it was in Sri Lanka.
 *
 * Colombo is UTC+5:30, so a payment between midnight and half past five on the
 * first of the month is still the previous month in UTC. On a tiered scheme
 * that is not a cosmetic difference: it moves a sale across a boundary and
 * changes the rate it pays, and the operator would be right to complain.
 */
const TZ = 'Asia/Colombo';

/** Statuses that mean the money arrived. */
const PAID_STATUSES = ['payment_received', 'paid', 'delivered', 'done', 'complete'];

/**
 * Freeze credit for an order, if it does not already have any.
 *
 * Idempotent by design: called on every transition into a paid status, and an
 * order that moves from payment_received to delivered must not be credited
 * twice or re-credited to someone else.
 *
 * @param {string} clientId
 * @param {string} orderId
 * @returns {Promise<{credited: boolean, userId: number|null, seq: number|null, reason: string}>}
 */
async function creditOrder(clientId, orderId) {
  const cur = await db.pgQuery(
    `SELECT phone_number, credited_at, credited_to, credit_reason, credit_seq
       FROM orders WHERE order_id=$1 AND client_id=$2`, [orderId, clientId]);
  if (!cur.rows.length) return { credited: false, userId: null, seq: null, reason: 'no such order' };

  const row = cur.rows[0];
  if (row.credited_at) {
    return { credited: false, userId: row.credited_to, seq: row.credit_seq,
             reason: 'already credited: ' + (row.credit_reason || '') };
  }

  const at = new Date();
  const { userId, reason } = await ownership.creditableOwner(clientId, row.phone_number, at);

  // Position within this operator's Colombo month. House sales have no
  // sequence, because nothing is paid on them and nothing counts toward N.
  let seq = null;
  if (userId) {
    const r = await db.pgQuery(
      `SELECT COUNT(*)::int AS n FROM orders
        WHERE client_id=$1 AND credited_to=$2
          AND date_trunc('month', credited_at AT TIME ZONE $4)
            = date_trunc('month', $3::timestamptz AT TIME ZONE $4)`,
      [clientId, userId, at.toISOString(), TZ]);
    seq = r.rows[0].n + 1;
  }

  await db.pgQuery(
    `UPDATE orders SET credited_to=$3, credited_at=$4, credit_reason=$5, credit_seq=$6
      WHERE order_id=$1 AND client_id=$2 AND credited_at IS NULL`,
    [orderId, clientId, userId, at.toISOString(), reason, seq]);

  console.log(`[CREDIT] ${clientId}/${orderId} -> ${userId ? `user ${userId} (#${seq} this month)` : 'house'}: ${reason}`);
  return { credited: true, userId, seq, reason };
}

/**
 * Credit an order if the status it is moving to means the money arrived.
 *
 * Safe to call on any status change; it does nothing for the rest.
 *
 * @param {string} clientId
 * @param {string} orderId
 * @param {string} status
 * @returns {Promise<void>}
 */
async function creditIfPaid(clientId, orderId, status) {
  if (!PAID_STATUSES.includes(status)) return;
  try {
    await creditOrder(clientId, orderId);
  } catch (e) {
    // A sale must never fail to be marked paid because crediting went wrong.
    // The order is the record that matters; credit can be repaired after.
    console.error(`[CREDIT] failed for ${clientId}/${orderId}:`, e.message);
  }
}

module.exports = { creditOrder, creditIfPaid, PAID_STATUSES, TZ };
