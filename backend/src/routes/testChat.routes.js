/**
 * @module routes/testChat.routes
 * @description Express router for the Test Chat sandbox.
 */

'use strict';

const router  = require('express').Router();
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
router.get('/config',                  jwtAuth, testConfig);
router.post('/config',                 jwtAuth, testConfig);

// Media extraction preview.
router.post('/extract',                jwtAuth, upload.single('file'), testExtract);

// Declared after the literal paths so they are not shadowed by :sessionId.
router.post('/:sessionId/message',     jwtAuth, sendTestMessage);
router.get('/:sessionId/messages',     jwtAuth, getTestMessages);
router.delete('/:sessionId',           jwtAuth, resetTestSession);

module.exports = router;
