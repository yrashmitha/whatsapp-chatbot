/**
 * @module middleware/jwtAuth
 * @description Express middleware that validates a Bearer JWT token
 * and attaches the decoded payload to req.user.
 */

'use strict';

const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');

/**
 * Verify the Bearer JWT in the Authorization header.
 * On success, attaches the decoded payload to req.user and calls next().
 * On failure, responds with 401 Unauthorized.
 *
 * @param {import('express').Request}  req  - Express request
 * @param {import('express').Response} res  - Express response
 * @param {import('express').NextFunction} next - Express next function
 * @returns {void}
 */
function jwtAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = jwtAuth;
