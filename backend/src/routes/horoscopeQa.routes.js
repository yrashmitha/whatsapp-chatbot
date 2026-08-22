/**
 * @module routes/horoscopeQa.routes
 * @description Express router for the follow-up Q&A feature.
 */

'use strict';

const router  = require('express').Router();
const jwtAuth = require('../middleware/jwtAuth');
const {
  getHoroscope,
  refreshHoroscope,
  askHoroscope,
} = require('../controllers/horoscopeQa.controller');

router.get('/:phone',          jwtAuth, getHoroscope);
router.post('/:phone/refresh', jwtAuth, refreshHoroscope);
router.post('/:phone/ask',     jwtAuth, askHoroscope);

module.exports = router;
