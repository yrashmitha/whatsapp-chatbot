/**
 * @module routes/crmUsers.routes
 * @description Express router for the operators who work a client's inbox.
 */

'use strict';

const router  = require('express').Router();
const jwtAuth = require('../middleware/jwtAuth');
const requirePermission = require('../middleware/requirePermission');
const {
  listUsers, listPermissions, createUser, updateUser, resetPassword,
  getCommission, saveCommission,
} = require('../controllers/crmUsers.controller');

// The catalogue is labels, not access: any signed-in user may read it so the UI
// can show a person what they themselves hold.
router.get('/permissions', jwtAuth, listPermissions);

router.get('/commission',   jwtAuth, requirePermission('payroll.view'), getCommission);
router.put('/commission',   jwtAuth, requirePermission('payroll.view'), saveCommission);
router.get('/',             jwtAuth, requirePermission('users.manage'), listUsers);
router.post('/',            jwtAuth, requirePermission('users.manage'), createUser);
router.patch('/:id',        jwtAuth, requirePermission('users.manage'), updateUser);
router.post('/:id/password',jwtAuth, requirePermission('users.manage'), resetPassword);

module.exports = router;
