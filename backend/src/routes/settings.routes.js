/**
 * @module routes/settings.routes
 * @description Express router for client settings endpoints (get, update prompt, change password).
 */

'use strict';

const router  = require('express').Router();
const requirePermission = require('../middleware/requirePermission');
const jwtAuth = require('../middleware/jwtAuth');
const { getSettings, updatePrompt, changePassword, updateTokens } = require('../controllers/settings.controller');

router.get('/',           jwtAuth, requirePermission('settings.prompts'), getSettings);
router.put('/prompt',     jwtAuth, requirePermission('settings.prompts'), updatePrompt);
router.put('/password',   jwtAuth, requirePermission('settings.keys'), changePassword);
router.put('/tokens',     jwtAuth, requirePermission('settings.keys'), updateTokens);

module.exports = router;
