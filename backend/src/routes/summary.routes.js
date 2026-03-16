'use strict';

const { Router } = require('express');
const jwtAuth = require('../middleware/jwtAuth');
const { getSummary } = require('../controllers/summary.controller');

const router = Router();
router.get('/', jwtAuth, getSummary);

module.exports = router;
