/**
 * @module routes/followUps.routes
 * @description Express router for the follow-up queue.
 */

'use strict';

const router  = require('express').Router();
const jwtAuth = require('../middleware/jwtAuth');
const { listFollowUps } = require('../controllers/followUps.controller');

router.get('/', jwtAuth, listFollowUps);

module.exports = router;
