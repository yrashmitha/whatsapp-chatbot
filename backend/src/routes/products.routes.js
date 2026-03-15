/**
 * @module routes/products.routes
 * @description Express router for CRM product and attribute management endpoints.
 * Mounted at /api/products — handles /api/products/* and /api/attributes/*.
 * Also handles /api/upload-image when mounted at /api.
 *
 * Note: /api/attributes/* routes are separately accessible via the products router
 * mounted at /api by the upload-image alias in routes/index.js.
 */

'use strict';

const router  = require('express').Router();
const jwtAuth = require('../middleware/jwtAuth');
const { upload } = require('../config/multer');
const {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  bulkImportProducts,
  listAttributes,
  createAttribute,
  updateAttribute,
  deleteAttribute,
  bulkImportAttributes,
  uploadImage,
} = require('../controllers/products.controller');

// ── Products ──────────────────────────────────────────────────────────────────
// Note: /bulk must come before /:id so it is not swallowed as an id
router.post('/bulk',         jwtAuth, bulkImportProducts);
router.get('/',              jwtAuth, listProducts);
router.get('/:id',           jwtAuth, getProduct);
router.post('/',             jwtAuth, createProduct);
router.put('/:id',           jwtAuth, updateProduct);
router.delete('/:id',        jwtAuth, deleteProduct);

module.exports = router;
