'use strict';

const router   = require('express').Router();
const jwtAuth  = require('../middleware/jwtAuth');
const { uploadMedia } = require('../config/multer');
const {
  listVoiceClips,
  createVoiceClip,
  deleteVoiceClip,
  sendVoiceClip,
} = require('../controllers/voice_clips.controller');

router.get   ('/',     jwtAuth, listVoiceClips);
router.post  ('/',     jwtAuth, uploadMedia.single('file'), createVoiceClip);
router.delete('/:id',  jwtAuth, deleteVoiceClip);

// CRM send-voice — mounted separately under /api/crm/send-voice
router.post('/send',   jwtAuth, sendVoiceClip);

module.exports = router;
