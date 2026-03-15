/**
 * @module routes/chat.routes
 * @description Express router for the web UI chat endpoint.
 */

'use strict';

const router = require('express').Router();
const { chat } = require('../controllers/chat.controller');

router.post('/', chat);

module.exports = router;
