/**
 * @module routes/public.routes
 * @description Public channel router for external frontends (the web FE).
 * Guarded by a shared API key + rate limiting. Mounted at /public (no JWT).
 */

'use strict';

const router     = require('express').Router();
const rateLimit  = require('express-rate-limit');
const apiKeyAuth = require('../middleware/apiKeyAuth');
const { publicChart, publicCreateOrder, publicMatch, publicDeepMatch } = require('../controllers/public.controller');

// 30 requests/minute per IP — the cache absorbs repeat chart lookups.
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// The public site is unauthenticated, so it cannot resolve a tenant from a JWT —
// it is pinned to WEB_CLIENT_ID. Refuse to serve at all when that is unset, so
// traffic and orders can never land in an arbitrary tenant.
const WEB_CLIENT_ID = process.env.WEB_CLIENT_ID || null;
function requireWebClient(req, res, next) {
  if (!WEB_CLIENT_ID) {
    return res.status(503).json({ error: 'Public endpoints are not configured (WEB_CLIENT_ID unset)' });
  }
  next();
}

router.use(publicLimiter, apiKeyAuth, requireWebClient);

router.post('/chart',  publicChart);
router.post('/orders', publicCreateOrder);
router.post('/match',  publicMatch);
router.post('/deep-match', publicDeepMatch);

module.exports = router;
