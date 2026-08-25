'use strict';

const express  = require('express');
const requirePermission = require('../middleware/requirePermission');
const jwtAuth  = require('../middleware/jwtAuth');
const { list, create, update, remove } = require('../controllers/quickReplies.controller');

const router = express.Router();

router.get('/',    jwtAuth, list);
router.post('/',   jwtAuth, requirePermission('settings.quick_replies'), create);
router.put('/:id', jwtAuth, requirePermission('settings.quick_replies'), update);
router.delete('/:id', jwtAuth, requirePermission('settings.quick_replies'), remove);

module.exports = router;
