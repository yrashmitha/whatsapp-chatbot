/**
 * @module routes/delivery.routes
 * @description Internal report-delivery channel for the www.puranajothirwedaya.com site.
 * Guarded by the shared X-Delivery-Key + rate limiting. Mounted at
 * /internal/delivery (no JWT).
 */

'use strict';

const router    = require('express').Router();
const rateLimit = require('express-rate-limit');
const deliveryKeyAuth = require('../middleware/deliveryKeyAuth');
const {
  internalStatus,
  internalVerify,
  internalFile,
} = require('../controllers/delivery.controller');

// The delivery site proxies every customer hit, so this is per-site, not
// per-customer. Generous, but bounded.
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(limiter, deliveryKeyAuth);

router.get('/:token',        internalStatus);
router.post('/:token/verify', internalVerify);
router.get('/:token/file',    internalFile);

module.exports = router;
