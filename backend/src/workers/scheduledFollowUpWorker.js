/**
 * @module workers/scheduledFollowUpWorker
 * @description Sends the follow-ups an operator approved for later.
 *
 * A minute of granularity is plenty: these are "tomorrow morning" reminders,
 * not alarms. The checks that decide whether a due message should still go out
 * live in the service, because they matter more than the timing does.
 */

'use strict';

const { runDue } = require('../services/scheduledFollowUps');

/** How often to look for anything due. */
const TICK_MS = 60 * 1000;

/**
 * Start the ticker.
 *
 * @returns {NodeJS.Timeout}
 */
function startScheduledFollowUpWorker() {
  console.log('[SCHEDULED] Worker started, checking every minute');
  return setInterval(async () => {
    try {
      const { sent, cancelled } = await runDue();
      if (sent || cancelled) {
        console.log(`[SCHEDULED] ${sent} sent, ${cancelled} stood down`);
      }
    } catch (e) {
      // One bad tick must not stop the ticker: the next one is a minute away.
      console.error('[SCHEDULED] Tick failed:', e.message);
    }
  }, TICK_MS);
}

module.exports = { startScheduledFollowUpWorker };
