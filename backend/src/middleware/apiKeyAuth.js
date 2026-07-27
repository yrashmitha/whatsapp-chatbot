/**
 * @module middleware/apiKeyAuth
 * @description Guards public channel endpoints (e.g. the web FE)
 * with a shared secret. The FE never holds this key in the browser — its
 * Next.js server proxy attaches it. Checks the `x-api-key` header against
 * WEB_API_KEY using a timing-safe comparison.
 */

'use strict';

const crypto = require('crypto');

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function apiKeyAuth(req, res, next) {
  const expected = process.env.WEB_API_KEY;
  if (!expected) {
    // Fail closed: if the server has no key configured, reject rather than allow all.
    return res.status(503).json({ error: 'Public API not configured' });
  }
  const provided = req.headers['x-api-key'];
  if (!provided || !timingSafeEqual(provided, expected)) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
}

module.exports = apiKeyAuth;
