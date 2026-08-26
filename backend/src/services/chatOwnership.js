/**
 * @module services/chatOwnership
 * @description Who is working a chat by hand, and who worked it before.
 *
 * Taking a chat over silences the bot for that customer. That is not a side
 * effect, it is the reason the mechanism is trustworthy: claiming costs the
 * operator something. Spraying claims across two hundred conversations to
 * harvest commission would take those conversations away from the thing that
 * was closing them, in one person's name, and the fall would be visible within
 * a day. A rule derived from who typed last has no such cost.
 *
 * Ownership lives on customer_settings alongside ai_enabled, because they are
 * two halves of one fact. The log beside it is append-only.
 */

'use strict';

const db = require('../db');

/**
 * How long an owned chat may sit without a reply before it is handed back.
 *
 * With the bot switched off, an unattended claim is a customer getting no
 * answer at all, so this is about the business before it is about payroll.
 */
const IDLE_RELEASE_HOURS = 4;

/**
 * Record a change of hands. Never updates, only appends.
 *
 * @param {string} clientId
 * @param {string} phone
 * @param {Object} entry
 * @param {number|null} entry.userId  - whose ownership is starting or ending
 * @param {number|null} entry.actorId - who performed it; differs on a takeover
 * @param {string} entry.action       - claim | release | takeover | auto_release
 * @param {string} [entry.reason]
 * @returns {Promise<void>}
 */
async function record(clientId, phone, { userId, actorId, action, reason }) {
  await db.pgQuery(
    `INSERT INTO chat_ownership_log (client_id, phone_number, user_id, actor_id, action, reason)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [clientId, phone, userId ?? null, actorId ?? null, action, reason || null]
  );
}

/**
 * Who currently owns a chat.
 *
 * @param {string} clientId
 * @param {string} phone
 * @returns {Promise<{owned_by: number|null, owned_at: Date|null, ai_enabled: boolean}>}
 */
async function ownerOf(clientId, phone) {
  const r = await db.pgQuery(
    `SELECT owned_by, owned_at, ai_enabled FROM customer_settings
      WHERE client_id=$1 AND phone_number=$2`, [clientId, phone]);
  return r.rows[0] || { owned_by: null, owned_at: null, ai_enabled: true };
}

/**
 * Take a chat over from the bot, or from whoever holds it.
 *
 * Taking it from a colleague is allowed and logged as a takeover with both
 * names on it. Forbidding it would just mean chats stranded behind whoever
 * happens to be off that day.
 *
 * @param {string} clientId
 * @param {string} phone
 * @param {number} userId - the operator claiming it
 * @returns {Promise<{owned_by: number, previous_owner: number|null}>}
 */
async function claim(clientId, phone, userId) {
  const before = await ownerOf(clientId, phone);
  // Only mark this as an undoable pause if we are the ones switching the bot
  // off. A chat that was already off was switched off by a person on purpose,
  // and taking it over must not quietly give that decision a four hour expiry.
  const weArePausing = before.ai_enabled !== false;
  await db.pgQuery(
    `INSERT INTO customer_settings (phone_number, client_id, ai_enabled, owned_by, owned_at, paused_at)
     VALUES ($2,$1,FALSE,$3,NOW(),CASE WHEN $4 THEN NOW() ELSE NULL END)
     ON CONFLICT (phone_number, client_id)
     DO UPDATE SET ai_enabled=FALSE, owned_by=$3, owned_at=NOW(),
                   paused_at = CASE WHEN $4 THEN NOW() ELSE customer_settings.paused_at END`,
    [clientId, phone, userId, weArePausing]
  );
  const takenFrom = before.owned_by && before.owned_by !== userId ? before.owned_by : null;
  if (takenFrom) {
    await record(clientId, phone, {
      userId: takenFrom, actorId: userId, action: 'release', reason: 'taken over by another operator',
    });
  }
  await record(clientId, phone, {
    userId, actorId: userId, action: takenFrom ? 'takeover' : 'claim',
  });
  console.log(`[OWNERSHIP] ${clientId}/${phone} claimed by user ${userId}${takenFrom ? ` from ${takenFrom}` : ''}`);
  return { owned_by: userId, previous_owner: takenFrom };
}

/**
 * Hand a chat back to the bot.
 *
 * Releasing does not surrender the sale. Credit is decided from the log at the
 * moment payment lands, and the customer paying two days after an operator
 * tidied up their queue is the normal case, not an edge one.
 *
 * @param {string} clientId
 * @param {string} phone
 * @param {number|null} actorId - who released it
 * @param {string} [action]     - release | auto_release
 * @param {string} [reason]
 * @returns {Promise<boolean>} whether it had been owned
 */
async function release(clientId, phone, actorId, action = 'release', reason) {
  const before = await ownerOf(clientId, phone);
  if (!before.owned_by) return false;
  await db.pgQuery(
    `UPDATE customer_settings SET ai_enabled=TRUE, owned_by=NULL, owned_at=NULL, paused_at=NULL
      WHERE client_id=$1 AND phone_number=$2`, [clientId, phone]);
  await record(clientId, phone, { userId: before.owned_by, actorId, action, reason });
  console.log(`[OWNERSHIP] ${clientId}/${phone} released by ${actorId ?? 'system'} (${action})`);
  return true;
}

/**
 * The operator a sale should be credited to, or null for a house sale.
 *
 * The rule is the most recent person to have owned this chat at or before the
 * moment the money arrived, provided they actually said something while they
 * held it. That second half is what makes claiming worthless on its own: a
 * chat claimed and dropped without a word earns nothing.
 *
 * Ownership before the payment rather than at it, because an operator who
 * chases an unpaid order and then tidies their queue should not lose the sale
 * for having handed the chat back before the customer got round to paying.
 *
 * @param {string} clientId
 * @param {string} phone
 * @param {Date|string} at - when payment was received
 * @returns {Promise<{userId: number|null, reason: string}>}
 */
async function creditableOwner(clientId, phone, at) {
  const r = await db.pgQuery(
    `SELECT user_id, action, created_at FROM chat_ownership_log
      WHERE client_id=$1 AND phone_number=$2 AND created_at <= $3
        AND action IN ('claim','takeover') AND user_id IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`,
    [clientId, phone, at]);
  if (!r.rows.length) return { userId: null, reason: 'house: nobody ever took this chat over' };

  const { user_id: userId, created_at: since } = r.rows[0];
  const spoke = await db.pgQuery(
    `SELECT COUNT(*)::int n FROM messages
      WHERE client_id=$1 AND phone_number=$2 AND sent_by=$3 AND created_at >= $4`,
    [clientId, phone, userId, since]);
  const said = spoke.rows[0].n;
  if (!said) {
    return { userId: null, reason: 'house: the chat was claimed but nothing was sent' };
  }
  // The count goes on the record deliberately. A sale credited after a single
  // message is not necessarily wrong - the closing message often is the sale -
  // but it should be visible rather than buried.
  return { userId, reason: `claimed and worked (${said} message${said === 1 ? '' : 's'})` };
}

/**
 * Somebody replied by hand, so the bot should stop answering this customer.
 *
 * Called on every manual send. If the sender can be credited with a sale - an
 * operator with their own login - this also claims the chat, because typing a
 * reply is taking the conversation over whether or not anyone pressed a button.
 * pj has no crm_users row and earns no commission, so pj's reply pauses the bot
 * and leaves the chat unowned, free for an operator to pick up and earn on.
 *
 * @param {string} clientId
 * @param {string} phone
 * @param {number|null} userId - the operator, or null for the owner
 * @returns {Promise<void>}
 */
async function pauseForManualReply(clientId, phone, userId) {
  if (userId) {
    const before = await ownerOf(clientId, phone);
    if (before.owned_by === userId) return;   // already theirs, nothing to say
    await claim(clientId, phone, userId);
    return;
  }
  // The owner: pause without taking ownership. Same rule - if the bot was
  // already off, that was a decision, and replying does not put a clock on it.
  await db.pgQuery(
    `INSERT INTO customer_settings (phone_number, client_id, ai_enabled, paused_at)
     VALUES ($2,$1,FALSE,NOW())
     ON CONFLICT (phone_number, client_id)
     DO UPDATE SET ai_enabled=FALSE,
                   paused_at = CASE WHEN customer_settings.ai_enabled
                                    THEN COALESCE(customer_settings.paused_at, NOW())
                                    ELSE customer_settings.paused_at END`,
     [clientId, phone]);
}

/**
 * Undo pauses that nobody followed up on.
 *
 * A chat paused by a manual reply and then forgotten gets no replies at all,
 * from anyone, which is worse than the bot answering imperfectly. So it resumes
 * on its own once it has been quiet for a while. A chat pj switched off
 * deliberately has no paused_at and is never touched.
 *
 * @param {number} [hours]
 * @returns {Promise<number>} how many resumed
 */
async function resumeIdle(hours = IDLE_RELEASE_HOURS) {
  const r = await db.pgQuery(
    `SELECT cs.client_id, cs.phone_number, cs.owned_by
       FROM customer_settings cs
      WHERE cs.paused_at IS NOT NULL
        AND cs.ai_enabled = FALSE
        AND cs.paused_at < NOW() - ($1 || ' hours')::interval
        AND NOT EXISTS (
          SELECT 1 FROM messages m
           WHERE m.client_id = cs.client_id AND m.phone_number = cs.phone_number
             AND m.sender_type = 'bot'
             AND m.created_at > NOW() - ($1 || ' hours')::interval)`,
    [String(hours)]);

  for (const row of r.rows) {
    if (row.owned_by) {
      await release(row.client_id, row.phone_number, null, 'auto_release',
                    `no reply for ${hours} hours`);
    } else {
      await db.pgQuery(
        `UPDATE customer_settings SET ai_enabled=TRUE, paused_at=NULL
          WHERE client_id=$1 AND phone_number=$2`, [row.client_id, row.phone_number]);
      await record(row.client_id, row.phone_number, {
        userId: null, actorId: null, action: 'auto_resume',
        reason: `no reply for ${hours} hours`,
      });
    }
    // Clear the pause marker either way, so it is not resumed twice.
    await db.pgQuery(
      `UPDATE customer_settings SET paused_at=NULL WHERE client_id=$1 AND phone_number=$2`,
      [row.client_id, row.phone_number]);
  }
  if (r.rows.length) console.log(`[OWNERSHIP] the bot resumed on ${r.rows.length} quiet chat(s)`);
  return r.rows.length;
}

module.exports = {
  claim, release, ownerOf, creditableOwner, resumeIdle,
  pauseForManualReply, IDLE_RELEASE_HOURS,
};
