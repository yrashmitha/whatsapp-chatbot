/**
 * @module workers/retryWorker
 * @description Background worker that retries failed WhatsApp messages
 * stored in message_retry_queue. Runs every 2 minutes.
 */

'use strict';

const db           = require('../db');
const clientRouter = require('../services/clientRouter');
const { buildChatSession, handleMessage } = require('../services/gemini');
const { sendBotReply } = require('../services/whatsapp');
const { chatSessions } = require('./sessionManager');

const RETRY_DELAYS_MIN = [5, 10, 20, 40, 60];

/**
 * Start the background retry worker interval.
 * Polls the message_retry_queue table every 2 minutes and retries up to 5
 * pending messages per tick.
 *
 * @returns {NodeJS.Timeout} Interval handle
 */
function startRetryWorker() {
  return setInterval(async () => {
    try {
      const { rows } = await db.pgQuery(
        `SELECT * FROM message_retry_queue
         WHERE resolved_at IS NULL AND retry_after <= NOW() AND attempts < max_attempts
         ORDER BY retry_after LIMIT 5`
      );
      if (!rows.length) return;

      for (const item of rows) {
        const nextAttempt = item.attempts + 1;
        const nextDelay = RETRY_DELAYS_MIN[nextAttempt] || 60;
        await db.pgQuery(
          `UPDATE message_retry_queue SET attempts=$1, retry_after=NOW() + $2::interval WHERE id=$3`,
          [nextAttempt, `${nextDelay} minutes`, item.id]
        );

        let sessionKey;
        try {
          console.log(`[RETRY-WORKER] Retrying msg from ${item.phone_number} (attempt ${nextAttempt}/${item.max_attempts})`);
          const client = await clientRouter.getClientById(item.client_id);
          if (!client) throw new Error('Client not found');

          // 24-hour window check — do not send if customer last messaged > 23h ago
          const custRow = await db.pgQuery(
            'SELECT last_customer_message_at FROM customers WHERE phone_number=$1 AND client_id=$2',
            [item.phone_number, item.client_id]
          );
          const lastMsg = custRow.rows[0]?.last_customer_message_at;
          if (lastMsg) {
            const hoursSince = (Date.now() - new Date(lastMsg).getTime()) / 36e5;
            if (hoursSince > 23) {
              await db.pgQuery(
                `UPDATE message_retry_queue SET resolved_at=NOW() WHERE id=$1`, [item.id]
              );
              console.warn(`[RETRY-WORKER] Skipping ${item.phone_number} — 24-hour window closed (${hoursSince.toFixed(1)}h since last message)`);
              continue;
            }
          }

          sessionKey = `${client.id}:${item.phone_number}`;
          if (!chatSessions.has(sessionKey)) {
            chatSessions.set(sessionKey, {
              chat: await buildChatSession(item.phone_number, client),
              phoneNumber: item.phone_number,
            });
          }
          const session = chatSessions.get(sessionKey);
          session.lastUsed = Date.now();

          const retryNote = `[SYSTEM: This is a retry. The customer's previous message could not be processed ${item.attempts} time(s) due to a temporary service issue. Please start your reply with a brief, natural apology for the short delay (e.g. "Sorry for the short wait! 🙏"), then respond normally to their message.]`;

          const { botReply } = await handleMessage(
            item.phone_number, item.message_text, session.chat,
            { skipUserInsert: true, client, retryNote }
          );

          await sendBotReply(item.phone_number, botReply, client);
          await db.pgQuery(`UPDATE message_retry_queue SET resolved_at=NOW() WHERE id=$1`, [item.id]);
          console.log(`[RETRY-WORKER] Success for ${item.phone_number}`);

        } catch (retryErr) {
          console.error(`[RETRY-WORKER] Attempt ${nextAttempt} failed for ${item.phone_number}:`, retryErr.message);
          // If the session history is corrupt, drop it so next attempt rebuilds fresh from DB
          if (/function response turn/i.test(retryErr.message || '')) {
            if (sessionKey) chatSessions.delete(sessionKey);
            console.warn(`[RETRY-WORKER] Dropped corrupt session for ${item.phone_number} — will rebuild on next attempt`);
          }
          if (nextAttempt >= item.max_attempts) {
            try {
              const client = await clientRouter.getClientById(item.client_id);
              if (client) {
                const { sendWhatsAppMessage } = require('../services/whatsapp');
                await sendWhatsAppMessage(
                  item.phone_number,
                  "We sincerely apologize — we're having prolonged technical difficulties. Please try contacting us again later. We're sorry for the trouble! 🙏",
                  client
                );
              }
            } catch (_) {}
            await db.pgQuery(`UPDATE message_retry_queue SET resolved_at=NOW() WHERE id=$1`, [item.id]);
            console.log(`[RETRY-WORKER] Max attempts reached for ${item.phone_number} — resolved as failed`);
          }
        }
      }
    } catch (e) {
      console.error(`[RETRY-WORKER] Worker error:`, e.message);
    }
  }, 2 * 60 * 1000);
}

module.exports = { startRetryWorker };
