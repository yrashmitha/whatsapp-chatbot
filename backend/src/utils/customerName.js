/**
 * @module utils/customerName
 * @description Reading a customer's name off an order, whatever key it landed under.
 *
 * The name is stored under whichever key the client's order fields specify, and
 * pj's has changed twice: `name`, then `customer_name` alongside it, then `b`
 * from 22 August after somebody edited the field and mangled the key. The label
 * stayed correct throughout, so nothing looked wrong until the name stopped
 * appearing.
 *
 * Every reader checked two of those three, so forty orders' worth of documents
 * were built with an empty name. One list, one definition, and old orders start
 * working again rather than only new ones.
 */

'use strict';

/**
 * Keys a customer name has been stored under, newest mistake last.
 *
 * `b` is not a sensible key and is here because real data uses it. If pj's
 * order field is ever renamed back, this keeps the orders written meanwhile
 * readable, so the rename does not have to be a migration.
 *
 * @type {string[]}
 */
const NAME_KEYS = ['customer_name', 'name', 'full_name', 'b'];

/**
 * The customer's name from an order's custom_fields.
 *
 * @param {Object|string|null} customFields - the order's custom_fields
 * @param {string} [fallback] - returned when nothing usable is found
 * @returns {string}
 */
function customerNameFrom(customFields, fallback = '') {
  if (!customFields) return fallback;
  let cf = customFields;
  if (typeof cf === 'string') {
    try { cf = JSON.parse(cf); } catch { return fallback; }
  }
  if (typeof cf !== 'object') return fallback;
  for (const key of NAME_KEYS) {
    const v = cf[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return fallback;
}

module.exports = { customerNameFrom, NAME_KEYS };
