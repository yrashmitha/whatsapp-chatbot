/**
 * @module routes/followUps.routes
 * @description Express router for the follow-up queue.
 */

'use strict';

const router  = require('express').Router();
const jwtAuth = require('../middleware/jwtAuth');
const orderScope = require('../middleware/orderScope');
const { listFollowUps, sendFollowUp, followUpStats } = require('../controllers/followUps.controller');

router.get('/',                  jwtAuth, listFollowUps);
router.get('/stats',             jwtAuth, followUpStats);
router.post('/:orderId/send',    jwtAuth, orderScope, sendFollowUp);

module.exports = router;
