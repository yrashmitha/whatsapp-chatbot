/**
 * @module routes/auth.routes
 * @description Express router for authentication endpoints (login, me, set-password).
 */

'use strict';

const router  = require('express').Router();
const requirePermission = require('../middleware/requirePermission');
const jwtAuth = require('../middleware/jwtAuth');
const { login, me, setPassword } = require('../controllers/auth.controller');

router.post('/login',        login);
router.get('/me',  jwtAuth,  me);
router.post('/set-password', jwtAuth, requirePermission('settings.keys'), setPassword);

module.exports = router;
