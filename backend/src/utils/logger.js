'use strict';

/**
 * Generate a short random trace ID for one message flow.
 * @returns {string} 6-char alphanumeric ID e.g. "a3f7b2"
 */
function genTraceId() {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Create a tagged logger bound to a specific trace/client/phone.
 * Every log line includes [trace=X] [client=Y] [phone=Z] for Railway filtering.
 *
 * @param {string} traceId  - Short trace ID for this message flow
 * @param {string} clientId - Client ID
 * @param {string} phone    - Customer phone number or BSUID
 * @returns {{ info, warn, error }}
 */
function makeLogger(traceId, clientId, phone) {
  const tag = `[trace=${traceId}] [client=${clientId || 'unknown'}] [phone=${phone || 'unknown'}]`;
  return {
    info:  (...args) => console.log(tag, ...args),
    warn:  (...args) => console.warn(tag, ...args),
    error: (...args) => console.error(tag, ...args),
  };
}

module.exports = { genTraceId, makeLogger };
