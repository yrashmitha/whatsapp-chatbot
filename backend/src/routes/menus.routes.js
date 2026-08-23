/**
 * @module routes/menus.routes
 * @description Express router for a client's tappable WhatsApp menus.
 */

'use strict';

const router  = require('express').Router();
const jwtAuth = require('../middleware/jwtAuth');
const { listMenus, saveMenus, previewMenu } = require('../controllers/menus.controller');

router.get('/',             jwtAuth, listMenus);
router.put('/',             jwtAuth, saveMenus);
router.post('/:id/preview', jwtAuth, previewMenu);

module.exports = router;
