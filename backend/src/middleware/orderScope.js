/**
 * @module middleware/orderScope
 * @description Express middleware that enforces tenant ownership of an order
 * before any handler touches it.
 *
 * Every plugin/addon route that acts on an order takes the order ID straight
 * from the URL or request body. Order IDs are guessable (`{prefix}{year}-{seq}`),
 * so without this guard any authenticated CRM user could read or mutate another
 * tenant's reports. Applying the check as route middleware — rather than adding
 * a client_id predicate to each of the ~50 individual SQL statements inside the
 * handlers — means a handler cannot be reached at all unless the order belongs
 * to the caller's client.
 */

'use strict';

const db              = require('../db');
const resolveClientId = require('./resolveClientId');

/**
 * Pull the order ID out of wherever this route carries it.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function extractOrderId(req) {
  return req.params?.orderId
      // `:id` is only consulted on routes where this guard is explicitly mounted
      // (the /api/orders/:id/* handlers), never on unrelated `:id` routes.
      || req.params?.id
      || req.body?.order_id
      || req.body?.orderId
      || req.query?.order_id
      || null;
}

/**
 * Verify that the order named by the request belongs to the caller's client.
 *
 * Responds 404 (not 403) when the order is missing or owned by another tenant,
 * so the endpoint never confirms that another tenant's order ID exists.
 *
 * A superadmin who has not selected a client resolves to a null clientId and
 * keeps today's cross-tenant access; selecting a client scopes them to it.
 *
 * On success attaches `req.order` (id + owning client) for handlers that want it.
 *
 * @param {import('express').Request}      req
 * @param {import('express').Response}     res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function orderScope(req, res, next) {
  const orderId = extractOrderId(req);
  // Routes where the order ID is optional (e.g. an ad-hoc tarot reading with no
  // saved order) have nothing to scope — let the handler validate its own input.
  if (!orderId) return next();

  const clientId = resolveClientId(req);
  if (!clientId && req.user?.role !== 'superadmin') {
    return res.status(400).json({ error: 'client_id required' });
  }

  try {
    const row = await db.getOrderForClient(orderId, clientId, 'order_id, client_id');
    if (!row) return res.status(404).json({ error: 'Order not found' });
    req.order = { id: row.order_id, clientId: row.client_id };
    next();
  } catch (err) {
    console.error('[ORDER_SCOPE] lookup failed:', err.message);
    res.status(500).json({ error: 'Order lookup failed' });
  }
}

module.exports = orderScope;
