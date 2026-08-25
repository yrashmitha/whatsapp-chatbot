'use strict';

const { Router } = require('express');
const requirePermission = require('../middleware/requirePermission');
const jwtAuth = require('../middleware/jwtAuth');
const {
  handleVoiceWebhook,
  handleGatherWebhook,
  handleStatusWebhook,
  serveAudio,
  listCallsHandler,
  getCallHandler,
} = require('../controllers/calls.controller');

const router = Router();

// ── Twilio webhooks (public — no JWT, Twilio posts here) ─────────────────────
router.post('/webhook/voice',  handleVoiceWebhook);
router.post('/webhook/gather', handleGatherWebhook);
router.post('/webhook/status', handleStatusWebhook);

// ── Audio serving (public — Twilio <Play> fetches the MP3) ──────────────────
router.get('/audio/:token', serveAudio);

// ── CRM UI (protected) ───────────────────────────────────────────────────────
router.get('/',         jwtAuth, requirePermission('chat.read'), listCallsHandler);
router.get('/:callSid', jwtAuth, requirePermission('chat.read'), getCallHandler);

module.exports = router;
