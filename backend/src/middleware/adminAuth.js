/**
 * @module middleware/adminAuth
 * @description Admin route protection — requires a valid superadmin JWT.
 */

'use strict';

const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');

function adminAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = adminAuth;
