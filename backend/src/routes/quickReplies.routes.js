'use strict';

const express  = require('express');
const jwtAuth  = require('../middleware/jwtAuth');
const { list, create, update, remove } = require('../controllers/quickReplies.controller');

const router = express.Router();

router.get('/',    jwtAuth, list);
router.post('/',   jwtAuth, create);
router.put('/:id', jwtAuth, update);
router.delete('/:id', jwtAuth, remove);

module.exports = router;
