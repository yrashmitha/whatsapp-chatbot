/**
 * @module middleware/deliveryKeyAuth
 * @description Guards the /internal/delivery/* endpoints with the shared
 * DELIVERY_INTERNAL_KEY that only the report-delivery site (www.puranajothirwedaya.com)
 * holds. Checked against the `X-Delivery-Key` header with a timing-safe
 * comparison. Fails closed when the key is unset.
 */

'use strict';

const crypto = require('crypto');
const { DELIVERY_INTERNAL_KEY } = require('../config/env');

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function deliveryKeyAuth(req, res, next) {
  if (!DELIVERY_INTERNAL_KEY) {
    return res.status(503).json({ error: 'Delivery API not configured' });
  }
  const provided = req.headers['x-delivery-key'];
  if (!provided || !timingSafeEqual(provided, DELIVERY_INTERNAL_KEY)) {
    return res.status(401).json({ error: 'Invalid delivery key' });
  }
  next();
}

module.exports = deliveryKeyAuth;
