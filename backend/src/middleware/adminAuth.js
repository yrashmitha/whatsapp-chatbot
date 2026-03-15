/**
 * @module middleware/adminAuth
 * @description Express middleware for legacy admin routes.
 * Currently passes all requests through (TODO: re-enable before production).
 */

'use strict';

/**
 * Admin authentication middleware.
 * Currently a passthrough — all requests are allowed.
 * Re-enable the password check before production deploy.
 *
 * @param {import('express').Request}  req  - Express request
 * @param {import('express').Response} res  - Express response
 * @param {import('express').NextFunction} next - Express next function
 * @returns {void}
 */
function adminAuth(req, res, next) {
  return next(); // TODO: re-enable password check before production deploy
  const pass = process.env.ADMIN_PASSWORD;
  if (!pass) return res.status(500).json({ error: 'ADMIN_PASSWORD not set' });
  const provided = req.query.pass || (req.headers.authorization || '').replace('Bearer ', '');
  if (provided !== pass) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

module.exports = adminAuth;
