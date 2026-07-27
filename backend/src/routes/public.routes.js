/**
 * @module routes/public.routes
 * @description Public channel router for external frontends (pahantharu web).
 * Guarded by a shared API key + rate limiting. Mounted at /public (no JWT).
 */

'use strict';

const router     = require('express').Router();
const rateLimit  = require('express-rate-limit');
const apiKeyAuth = require('../middleware/apiKeyAuth');
const { publicChart, publicCreateOrder } = require('../controllers/public.controller');

// 30 requests/minute per IP — the cache absorbs repeat chart lookups.
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(publicLimiter, apiKeyAuth);

router.post('/chart',  publicChart);
router.post('/orders', publicCreateOrder);

module.exports = router;
