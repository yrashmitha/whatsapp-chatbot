/**
 * @module routes/orders.routes
 * @description Express router for CRM order management endpoints.
 */

'use strict';

const router  = require('express').Router();
const jwtAuth = require('../middleware/jwtAuth');
const orderScope = require('../middleware/orderScope');
const {
  listOrders,
  exportOrders,
  incomeSummary,
  updateStatus,
  updateFields,
  updateNotes,
  createOrder,
} = require('../controllers/orders.controller');

router.get('/',               jwtAuth, listOrders);
router.post('/',              jwtAuth, createOrder);
router.get('/export',         jwtAuth, exportOrders);
router.get('/income-summary', jwtAuth, incomeSummary);
router.patch('/:id/status',  jwtAuth, orderScope, updateStatus);
router.patch('/:id/fields',  jwtAuth, orderScope, updateFields);
router.patch('/:id/notes',   jwtAuth, orderScope, updateNotes);

module.exports = router;
