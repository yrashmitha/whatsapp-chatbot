'use strict';

const router = require('express').Router();
const requirePermission = require('../middleware/requirePermission');
const jwtAuth = require('../middleware/jwtAuth');
const { results } = require('../controllers/strategy.controller');

router.get('/', jwtAuth, requirePermission('settings.prompts'), results);

module.exports = router;
