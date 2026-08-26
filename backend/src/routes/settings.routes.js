/**
 * @module routes/settings.routes
 * @description Express router for client settings endpoints (get, update prompt, change password).
 */

'use strict';

const router  = require('express').Router();
const requirePermission = require('../middleware/requirePermission');
const jwtAuth = require('../middleware/jwtAuth');
const { getSettings, updatePrompt, changePassword, updateTokens, setAiMode } = require('../controllers/settings.controller');

// Anyone signed in may read it; getSettings decides how much of it they see.
router.get('/',           jwtAuth, getSettings);
router.put('/prompt',     jwtAuth, requirePermission('settings.prompts'), updatePrompt);
router.put('/password',   jwtAuth, requirePermission('settings.keys'), changePassword);
router.put('/tokens',     jwtAuth, requirePermission('settings.keys'), updateTokens);
router.put('/ai-mode',    jwtAuth, requirePermission('settings.prompts'), setAiMode);

module.exports = router;
