/**
 * @module routes/testChat.routes
 * @description Express router for the Test Chat sandbox.
 */

'use strict';

const router  = require('express').Router();
const requirePermission = require('../middleware/requirePermission');
const jwtAuth = require('../middleware/jwtAuth');
const { upload } = require('../config/multer');
const {
  sendTestMessage,
  getTestMessages,
  resetTestSession,
  testConfig,
  testExtract,
} = require('../controllers/testChat.controller');

// Draft prompt applied to test sessions only.
router.get('/config',                  jwtAuth, requirePermission('ai.test_chat'), testConfig);
router.post('/config',                 jwtAuth, requirePermission('ai.test_chat'), testConfig);

// Media extraction preview.
router.post('/extract',                jwtAuth, requirePermission('ai.test_chat'), upload.single('file'), testExtract);

// Declared after the literal paths so they are not shadowed by :sessionId.
router.post('/:sessionId/message',     jwtAuth, requirePermission('ai.test_chat'), sendTestMessage);
router.get('/:sessionId/messages',     jwtAuth, requirePermission('ai.test_chat'), getTestMessages);
router.delete('/:sessionId',           jwtAuth, requirePermission('ai.test_chat'), resetTestSession);

module.exports = router;
