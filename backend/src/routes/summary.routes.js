'use strict';

const { Router } = require('express');
const requirePermission = require('../middleware/requirePermission');
const jwtAuth = require('../middleware/jwtAuth');
const { getSummary } = require('../controllers/summary.controller');

const router = Router();
router.get('/', jwtAuth, requirePermission('orders.view'), getSummary);

module.exports = router;
