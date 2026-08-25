/**
 * @module routes/followUps.routes
 * @description Express router for the follow-up queue.
 */

'use strict';

const router  = require('express').Router();
const requirePermission = require('../middleware/requirePermission');
const jwtAuth = require('../middleware/jwtAuth');
const orderScope = require('../middleware/orderScope');
const { listFollowUps, sendFollowUp, followUpStats,
        scheduleFollowUp, listScheduled, cancelScheduled,
        getPrompt, savePrompt } = require('../controllers/followUps.controller');

router.get('/',                  jwtAuth, requirePermission('followups.view'), listFollowUps);
router.get('/stats',             jwtAuth, requirePermission('followups.view'), followUpStats);
router.get('/prompt',             jwtAuth, requirePermission('followups.prompt'), getPrompt);
router.put('/prompt',             jwtAuth, requirePermission('followups.prompt'), savePrompt);
router.get('/scheduled',          jwtAuth, requirePermission('followups.view'), listScheduled);
router.delete('/scheduled/:id',   jwtAuth, requirePermission('followups.schedule'), cancelScheduled);
router.post('/:orderId/send',     jwtAuth, requirePermission('followups.send'), orderScope, sendFollowUp);
router.post('/:orderId/schedule', jwtAuth, requirePermission('followups.schedule'), orderScope, scheduleFollowUp);

module.exports = router;
