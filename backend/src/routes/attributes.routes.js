/**
 * @module routes/attributes.routes
 * @description Express router for product attribute schema management endpoints.
 * Mounted at /api/attributes.
 */

'use strict';

const router  = require('express').Router();
const requirePermission = require('../middleware/requirePermission');
const jwtAuth = require('../middleware/jwtAuth');
const {
  listAttributes,
  createAttribute,
  updateAttribute,
  deleteAttribute,
  bulkImportAttributes,
} = require('../controllers/products.controller');

// Note: /bulk must come before /:id
router.post('/bulk',    jwtAuth, requirePermission('settings.products'), bulkImportAttributes);
router.get('/',         jwtAuth, listAttributes);
router.post('/',        jwtAuth, requirePermission('settings.products'), createAttribute);
router.put('/:id',      jwtAuth, requirePermission('settings.products'), updateAttribute);
router.delete('/:id',   jwtAuth, requirePermission('settings.products'), deleteAttribute);

module.exports = router;
