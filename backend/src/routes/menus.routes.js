/**
 * @module routes/menus.routes
 * @description Express router for a client's tappable WhatsApp menus.
 */

'use strict';

const router  = require('express').Router();
const requirePermission = require('../middleware/requirePermission');
const jwtAuth = require('../middleware/jwtAuth');
const { listMenus, saveMenus, previewMenu } = require('../controllers/menus.controller');

router.get('/',             jwtAuth, requirePermission('settings.menus'), listMenus);
router.put('/',             jwtAuth, requirePermission('settings.menus'), saveMenus);
router.post('/:id/preview', jwtAuth, requirePermission('settings.menus'), previewMenu);

module.exports = router;
