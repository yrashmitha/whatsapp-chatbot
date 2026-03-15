/**
 * @module routes/attributes.routes
 * @description Express router for product attribute schema management endpoints.
 * Mounted at /api/attributes.
 */

'use strict';

const router  = require('express').Router();
const jwtAuth = require('../middleware/jwtAuth');
const {
  listAttributes,
  createAttribute,
  updateAttribute,
  deleteAttribute,
  bulkImportAttributes,
} = require('../controllers/products.controller');

// Note: /bulk must come before /:id
router.post('/bulk',    jwtAuth, bulkImportAttributes);
router.get('/',         jwtAuth, listAttributes);
router.post('/',        jwtAuth, createAttribute);
router.put('/:id',      jwtAuth, updateAttribute);
router.delete('/:id',   jwtAuth, deleteAttribute);

module.exports = router;
