/**
 * @module routes/orders.routes
 * @description Express router for CRM order management endpoints.
 */

'use strict';

const router  = require('express').Router();
const requirePermission = require('../middleware/requirePermission');
const jwtAuth = require('../middleware/jwtAuth');
const orderScope = require('../middleware/orderScope');
const {
  listOrders,
  exportOrders,
  incomeSummary,
  ordersByAd,
  updateStatus,
  updateFields,
  updateNotes,
  createOrder,
  deleteOrder,
  addRemark,
  deleteRemark,
  adScorecard,
} = require('../controllers/orders.controller');

router.get('/',               jwtAuth, requirePermission('orders.view'), listOrders);
router.post('/',              jwtAuth, requirePermission('orders.create'), createOrder);
router.get('/export',         jwtAuth, requirePermission('orders.export'), exportOrders);
router.get('/income-summary', jwtAuth, incomeSummary);
router.get('/by-ad',          jwtAuth, requirePermission('finance.income'), ordersByAd);
// Per ad: Meta spend for the period, sales at each price, revenue per unit spent
router.get('/ad-scorecard',   jwtAuth, requirePermission('finance.income'), adScorecard);
router.patch('/:id/status',  jwtAuth, requirePermission('orders.status'), orderScope, updateStatus);
router.patch('/:id/fields',  jwtAuth, requirePermission('orders.edit'), orderScope, updateFields);
router.patch('/:id/notes',   jwtAuth, requirePermission('orders.edit'), orderScope, updateNotes);
router.post('/:id/remarks',            jwtAuth, requirePermission('orders.remarks'), orderScope, addRemark);
router.delete('/:id/remarks/:index',   jwtAuth, requirePermission('orders.remarks'), orderScope, deleteRemark);
router.delete('/:id',                  jwtAuth, requirePermission('orders.delete'), orderScope, deleteOrder);

module.exports = router;
