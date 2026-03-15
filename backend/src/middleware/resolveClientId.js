/**
 * @module middleware/resolveClientId
 * @description Helper function to extract the effective client ID from a
 * JWT-authenticated request. Superadmins may specify any client via query
 * param; regular client users are restricted to their own client ID.
 */

'use strict';

/**
 * Determine which client_id applies to the current authenticated request.
 *
 * - Superadmin: uses ?client_id= query param or req.body.client_id.
 * - Client user: always returns their own clientId from the JWT payload.
 *
 * @param {import('express').Request} req - Express request (must have req.user set by jwtAuth)
 * @returns {string|null} Resolved client ID, or null if none applicable
 */
function resolveClientId(req) {
  if (req.user?.role === 'superadmin') return req.query.client_id || req.body?.client_id || null;
  return req.user?.clientId || null;
}

module.exports = resolveClientId;
