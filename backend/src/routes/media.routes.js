/**
 * @module routes/media.routes
 * @description Express router for media library and WhatsApp media proxy endpoints.
 */

'use strict';

const router     = require('express').Router();
const jwtAuth    = require('../middleware/jwtAuth');
const { uploadDisk } = require('../config/multer');
const {
  uploadMediaFile,
  listMedia,
  createMedia,
  updateMedia,
  deleteMedia,
  proxyWhatsAppMedia,
} = require('../controllers/media.controller');

router.post('/upload',  jwtAuth, uploadDisk.single('image'), uploadMediaFile);
router.get('/',         jwtAuth, listMedia);
router.post('/',        jwtAuth, createMedia);
router.patch('/:id',    jwtAuth, updateMedia);
router.delete('/:id',   jwtAuth, deleteMedia);

// WhatsApp media proxy — must come after specific routes
router.get('/:mediaId', jwtAuth, proxyWhatsAppMedia);

module.exports = router;
