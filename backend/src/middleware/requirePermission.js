/**
 * @module middleware/requirePermission
 * @description Route guard for a single permission from services/permissions.
 *
 * Use it after jwtAuth on anything an operator should not necessarily reach:
 *
 *   router.delete('/:id', jwtAuth, requirePermission('orders.delete'), orderScope, deleteOrder);
 *
 * Returns 403 rather than 404. Hiding a route's existence matters when the id
 * in it belongs to another tenant - that is orderScope's job - but here the
 * caller is legitimately inside their own tenant and simply lacks the right, and
 * a 404 would send them hunting for a bug that is not there.
 */

'use strict';

const { hasPermission, VALID } = require('../services/permissions');

/**
 * Build middleware that admits only users holding `permission`.
 *
 * Throws at require time on an unknown id, so a typo is a boot failure rather
 * than a route that silently admits nobody - or worse, one that looks guarded
 * in the source and is not.
 *
 * @param {string} permission - an id from services/permissions
 * @returns {import('express').RequestHandler}
 */
function requirePermission(permission) {
  if (!VALID.has(permission)) {
    throw new Error(`requirePermission: unknown permission "${permission}"`);
  }
  return function (req, res, next) {
    if (hasPermission(req.user, permission)) return next();
    res.status(403).json({ error: 'You do not have permission to do that', permission });
  };
}

module.exports = requirePermission;
