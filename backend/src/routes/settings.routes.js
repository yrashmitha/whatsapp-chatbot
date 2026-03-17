/**
 * @module routes/settings.routes
 * @description Express router for client settings endpoints (get, update prompt, change password).
 */

'use strict';

const router  = require('express').Router();
const jwtAuth = require('../middleware/jwtAuth');
const { getSettings, updatePrompt, changePassword, updateTokens } = require('../controllers/settings.controller');

router.get('/',           jwtAuth, getSettings);
router.put('/prompt',     jwtAuth, updatePrompt);
router.put('/password',   jwtAuth, changePassword);
router.put('/tokens',     jwtAuth, updateTokens);

module.exports = router;
