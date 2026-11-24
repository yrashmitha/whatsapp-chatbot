/**
 * @module routes/automations
 * @description Automatic message rules (owner, or an operator given automations.manage).
 */

'use strict';

const router = require('express').Router();
const jwtAuth = require('../middleware/jwtAuth');
const requirePermission = require('../middleware/requirePermission');
const { listRules, createRule, updateRule, deleteRule, previewRule } = require('../controllers/automations.controller');

router.get('/',          jwtAuth, requirePermission('automations.manage'), listRules);
router.post('/preview',  jwtAuth, requirePermission('automations.manage'), previewRule);
router.post('/',         jwtAuth, requirePermission('automations.manage'), createRule);
router.patch('/:id',     jwtAuth, requirePermission('automations.manage'), updateRule);
router.delete('/:id',    jwtAuth, requirePermission('automations.manage'), deleteRule);

module.exports = router;
