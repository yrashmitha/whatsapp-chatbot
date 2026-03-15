/**
 * @module routes/catalog.routes
 * @description Express router for the public product catalog API (no auth required).
 */

'use strict';

const router = require('express').Router();
const { getPublicCatalog } = require('../controllers/catalog.controller');

router.get('/:clientId', getPublicCatalog);

module.exports = router;
