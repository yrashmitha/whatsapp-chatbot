/**
 * @module routes/webhook.routes
 * @description Express router for WhatsApp webhook endpoints (verification + message receive).
 */

'use strict';

const router = require('express').Router();
const { verifyWebhook, receiveWebhook } = require('../controllers/webhook.controller');

router.get('/',  verifyWebhook);
router.post('/', receiveWebhook);

module.exports = router;
