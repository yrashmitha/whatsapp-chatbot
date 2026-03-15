/**
 * @module routes/orders.routes
 * @description Express router for CRM order management endpoints.
 */

'use strict';

const router  = require('express').Router();
const jwtAuth = require('../middleware/jwtAuth');
const {
  listOrders,
  exportOrders,
  updateStatus,
  updateFields,
  updateNotes,
} = require('../controllers/orders.controller');

router.get('/',              jwtAuth, listOrders);
router.get('/export',        jwtAuth, exportOrders);
router.patch('/:id/status',  jwtAuth, updateStatus);
router.patch('/:id/fields',  jwtAuth, updateFields);
router.patch('/:id/notes',   jwtAuth, updateNotes);

module.exports = router;
