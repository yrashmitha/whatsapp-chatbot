/**
 * @module routes/horoscopeQa.routes
 * @description Express router for the follow-up Q&A feature.
 */

'use strict';

const router  = require('express').Router();
const requirePermission = require('../middleware/requirePermission');
const jwtAuth = require('../middleware/jwtAuth');
const {
  getHoroscope,
  refreshHoroscope,
  askHoroscope,
} = require('../controllers/horoscopeQa.controller');

router.get('/:phone',          jwtAuth, requirePermission('orders.view'), getHoroscope);
router.post('/:phone/refresh', jwtAuth, requirePermission('ai.generate_report'), refreshHoroscope);
router.post('/:phone/ask',     jwtAuth, requirePermission('ai.generate_report'), askHoroscope);

module.exports = router;
