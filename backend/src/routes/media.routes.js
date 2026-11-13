/**
 * @module routes/media.routes
 * @description Express router for media library and WhatsApp media proxy endpoints.
 */

'use strict';

const router     = require('express').Router();
const requirePermission = require('../middleware/requirePermission');
const jwtAuth    = require('../middleware/jwtAuth');
const { uploadDisk } = require('../config/multer');
const {
  uploadMediaFile,
  listMedia,
  createMedia,
  updateMedia,
  deleteMedia,
  proxyWhatsAppMedia,
  listMediaGroups,
  createMediaGroup,
  updateMediaGroup,
  deleteMediaGroup,
} = require('../controllers/media.controller');

router.post('/upload',  jwtAuth, requirePermission('settings.media'), uploadDisk.single('image'), uploadMediaFile);
// Saved groups of library items, sent together from the chat. Before /:id and
// the /:mediaId proxy below, which would otherwise take "groups" as an id.
router.get('/groups',          jwtAuth, listMediaGroups);
router.post('/groups',         jwtAuth, requirePermission('settings.media'), createMediaGroup);
router.patch('/groups/:id',    jwtAuth, requirePermission('settings.media'), updateMediaGroup);
router.delete('/groups/:id',   jwtAuth, requirePermission('settings.media'), deleteMediaGroup);
router.get('/',         jwtAuth, listMedia);
router.post('/',        jwtAuth, requirePermission('settings.media'), createMedia);
router.patch('/:id',    jwtAuth, requirePermission('settings.media'), updateMedia);
router.delete('/:id',   jwtAuth, requirePermission('settings.media'), deleteMedia);

// WhatsApp media proxy — must come after specific routes
router.get('/:mediaId', jwtAuth, proxyWhatsAppMedia);

module.exports = router;
