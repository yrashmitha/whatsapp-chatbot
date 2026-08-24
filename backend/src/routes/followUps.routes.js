/**
 * @module routes/followUps.routes
 * @description Express router for the follow-up queue.
 */

'use strict';

const router  = require('express').Router();
const jwtAuth = require('../middleware/jwtAuth');
const orderScope = require('../middleware/orderScope');
const { listFollowUps, sendFollowUp, followUpStats,
        scheduleFollowUp, listScheduled, cancelScheduled,
        getPrompt, savePrompt } = require('../controllers/followUps.controller');

router.get('/',                  jwtAuth, listFollowUps);
router.get('/stats',             jwtAuth, followUpStats);
router.get('/prompt',             jwtAuth, getPrompt);
router.put('/prompt',             jwtAuth, savePrompt);
router.get('/scheduled',          jwtAuth, listScheduled);
router.delete('/scheduled/:id',   jwtAuth, cancelScheduled);
router.post('/:orderId/send',     jwtAuth, orderScope, sendFollowUp);
router.post('/:orderId/schedule', jwtAuth, orderScope, scheduleFollowUp);

module.exports = router;
