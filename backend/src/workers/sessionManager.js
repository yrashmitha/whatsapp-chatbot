/**
 * @module workers/sessionManager
 * @description Singleton in-memory chat session store with TTL eviction.
 * All controllers that need to read or invalidate sessions must import
 * chatSessions from this module to guarantee a single shared Map.
 */

'use strict';

/**
 * Singleton map of active chat sessions.
 * Key format: `${clientId}:${phoneNumber}` for WhatsApp sessions,
 * or the sessionId string for web-chat sessions.
 *
 * @type {Map<string, {chat: Object, phoneNumber: string, lastUsed: number, [key: string]: any}>}
 */
const chatSessions = new Map();

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Start the periodic eviction timer that removes sessions idle for more than
 * SESSION_TTL_MS (2 hours). Runs every 30 minutes.
 *
 * @returns {NodeJS.Timeout} The interval handle (call clearInterval to stop)
 */
function startEviction() {
  return setInterval(() => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    let evicted = 0;
    for (const [key, session] of chatSessions.entries()) {
      if ((session.lastUsed || 0) < cutoff) {
        chatSessions.delete(key);
        evicted++;
      }
    }
    if (evicted > 0) {
      console.log(`[SESSION-GC] Evicted ${evicted} idle sessions, ${chatSessions.size} remaining`);
    }
  }, 30 * 60 * 1000);
}

module.exports = { chatSessions, startEviction };
