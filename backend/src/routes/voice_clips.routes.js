'use strict';

const router   = require('express').Router();
const requirePermission = require('../middleware/requirePermission');
const jwtAuth  = require('../middleware/jwtAuth');
const { uploadMedia } = require('../config/multer');
const {
  listVoiceClips,
  createVoiceClip,
  deleteVoiceClip,
  sendVoiceClip,
} = require('../controllers/voice_clips.controller');

router.get   ('/',     jwtAuth, listVoiceClips);
router.post  ('/',     jwtAuth, requirePermission('settings.voice_clips'), uploadMedia.single('file'), createVoiceClip);
router.delete('/:id',  jwtAuth, requirePermission('settings.voice_clips'), deleteVoiceClip);

// CRM send-voice — mounted separately under /api/crm/send-voice
router.post('/send',   jwtAuth, requirePermission('chat.send_media'), sendVoiceClip);

module.exports = router;
