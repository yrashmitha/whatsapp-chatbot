/**
 * @module controllers/calls.controller
 * @description Handles Twilio inbound call webhooks, Google Cloud TTS audio
 * serving, and CRM call log endpoints for the AI Call Answering addon.
 *
 * Flow:
 *   Caller → Twilio → /webhook/voice → TwiML greeting + <Gather>
 *                   → /webhook/gather → Gemini → TTS → TwiML <Play> + <Gather>
 *                   → /webhook/status → update DB + generate AI summary
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('../db');
const resolveClientId = require('../middleware/resolveClientId');
const { PUBLIC_URL } = require('../config/env');

// ─── In-memory audio cache (token → { buffer, mime, expiresAt }) ─────────────
/** @type {Map<string, { buffer: Buffer, expiresAt: number }>} */
const audioCache = new Map();
const AUDIO_TTL_MS = 60_000; // 60 seconds

function cacheAudio(buffer) {
  const token = uuidv4();
  audioCache.set(token, { buffer, expiresAt: Date.now() + AUDIO_TTL_MS });
  // Lazy cleanup of expired entries
  setTimeout(() => audioCache.delete(token), AUDIO_TTL_MS + 1000);
  return token;
}

// ─── Google Cloud TTS helper ─────────────────────────────────────────────────
/**
 * Synthesize text to MP3 audio using Google Cloud Text-to-Speech API.
 * @param {string} text - Text to synthesize
 * @param {string} voiceName - Voice name (e.g. 'si-LK-Wavenet-A')
 * @returns {Promise<Buffer>} MP3 audio buffer
 */
async function synthesizeSpeech(text, voiceName = 'si-LK-Standard-A') {
  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_TTS_API_KEY not configured');

  // Use the REST API directly (avoids service account / ADC complexity)
  const axios = require('axios');
  const langCode = voiceName.split('-').slice(0, 2).join('-'); // e.g. si-LK
  const body = {
    input: { text },
    voice: { languageCode: langCode, name: voiceName },
    audioConfig: { audioEncoding: 'MP3' },
  };
  console.log(`[TTS] Requesting voice=${voiceName} lang=${langCode} text="${text.slice(0, 80)}"`);
  let resp;
  try {
    resp = await axios.post(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      body,
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (axiosErr) {
    const errData = axiosErr.response?.data;
    console.error('[TTS] API error:', JSON.stringify(errData || axiosErr.message));
    throw new Error(`TTS API ${axiosErr.response?.status}: ${JSON.stringify(errData?.error?.message || errData || axiosErr.message)}`);
  }
  if (!resp.data?.audioContent) {
    console.error('[TTS] No audioContent in response:', JSON.stringify(resp.data));
    throw new Error('TTS returned no audioContent');
  }
  console.log(`[TTS] audioContent length=${resp.data.audioContent.length} chars (base64)`);
  return Buffer.from(resp.data.audioContent, 'base64');
}

// ─── Gemini helper (bare model for call AI — no CRM tools) ───────────────────
/**
 * Call Gemini for a conversational reply given a system prompt and transcript.
 * @param {string} systemPrompt - Personality / instructions
 * @param {Array<{speaker: string, text: string}>} transcript - Conversation so far
 * @param {string} [apiKey] - Optional per-client API key
 * @returns {Promise<string>} AI text response
 */
async function geminiCallReply(systemPrompt, transcript, apiKey) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  const genAI = new GoogleGenerativeAI(key);
  const callModel = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: systemPrompt || 'You are a helpful telephone receptionist. Keep responses concise and conversational.',
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 256,
      thinkingConfig: { thinkingBudget: 0 }, // disable thinking for low-latency call replies
    },
  });

  // Build history as alternating user/model turns
  const history = [];
  for (const turn of transcript.slice(0, -1)) {
    history.push({
      role: turn.speaker === 'caller' ? 'user' : 'model',
      parts: [{ text: turn.text }],
    });
  }

  const lastTurn = transcript[transcript.length - 1];
  const chat = callModel.startChat({ history });
  const result = await chat.sendMessage(lastTurn?.text || '');
  return result.response.text().trim();
}

// ─── Resolve addon + plugin config helper ────────────────────────────────────
async function loadCallConfig(clientId) {
  const addonCheck = await db.pgQuery(
    `SELECT enabled FROM client_addons WHERE client_id=$1 AND addon_id='ai_call_answering' AND enabled=TRUE`,
    [clientId]
  );
  if (!addonCheck.rows.length) return null;

  const config = await db.getPluginConfig(clientId, 'ai_call_answering');
  return {
    systemPrompt: config.system_prompt || '',
    greeting:     config.greeting     || 'Hello, how can I help you today?',
    ttsVoice:     config.tts_voice    || 'si-LK-Standard-A',
    geminiApiKey: config.api_key      || null,
  };
}

// ─── TwiML helpers ────────────────────────────────────────────────────────────
const BASE_URL = PUBLIC_URL || '';

function getLangCode(ttsVoice) {
  // Derive STT language from TTS voice name (e.g. 'en-US-Neural2-F' → 'en-US', 'si-LK-Wavenet-A' → 'si-LK')
  return (ttsVoice || 'en-US-Neural2-F').split('-').slice(0, 2).join('-');
}

function gatherTwiML(clientId, audioToken, ttsVoice) {
  const audioUrl    = `${BASE_URL}/api/calls/audio/${audioToken}`;
  const gatherAction = `${BASE_URL}/api/calls/webhook/gather?client_id=${encodeURIComponent(clientId)}`;
  const redirectUrl  = `${BASE_URL}/api/calls/webhook/gather?client_id=${encodeURIComponent(clientId)}&empty=1`;
  const language    = getLangCode(ttsVoice);

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" language="${language}" action="${gatherAction}" speechTimeout="2" timeout="10" actionOnEmptyResult="true">
    <Play>${audioUrl}</Play>
  </Gather>
  <Redirect>${redirectUrl}</Redirect>
</Response>`;
}

function repromptTwiML(clientId, ttsVoice) {
  const gatherAction = `${BASE_URL}/api/calls/webhook/gather?client_id=${encodeURIComponent(clientId)}`;
  const redirectUrl  = `${BASE_URL}/api/calls/webhook/gather?client_id=${encodeURIComponent(clientId)}&empty=1`;
  const language    = getLangCode(ttsVoice);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" language="${language}" action="${gatherAction}" speechTimeout="2" timeout="10" actionOnEmptyResult="true">
  </Gather>
  <Redirect>${redirectUrl}</Redirect>
</Response>`;
}

// ─── Webhook handlers ─────────────────────────────────────────────────────────

/**
 * POST /api/calls/webhook/voice — initial Twilio webhook when call is answered.
 */
async function handleVoiceWebhook(req, res) {
  res.type('text/xml');
  const clientId = req.query.client_id;
  console.log(`[CALLS/voice] clientId=${clientId} body=`, JSON.stringify(req.body));

  if (!clientId) {
    console.warn('[CALLS/voice] No client_id in query — hanging up');
    return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }

  const { CallSid, From, To } = req.body;
  console.log(`[CALLS/voice] CallSid=${CallSid} From=${From} To=${To}`);

  try {
    const cfg = await loadCallConfig(clientId);
    if (!cfg) {
      console.warn(`[CALLS/voice] Addon not enabled for client=${clientId} — hanging up`);
      return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
    }
    console.log(`[CALLS/voice] Config loaded: voice=${cfg.ttsVoice} greeting="${cfg.greeting}"`);

    await db.insertCall(CallSid, clientId, From || '', To || '');
    console.log(`[CALLS/voice] Call record inserted: ${CallSid}`);

    console.log(`[CALLS/voice] Synthesizing greeting via TTS...`);
    const audioBuffer = await synthesizeSpeech(cfg.greeting, cfg.ttsVoice);
    console.log(`[CALLS/voice] TTS OK — audio size=${audioBuffer.length} bytes`);

    const token = cacheAudio(audioBuffer);
    const audioUrl = `${BASE_URL}/api/calls/audio/${token}`;
    console.log(`[CALLS/voice] Audio cached at: ${audioUrl}`);

    const twiml = gatherTwiML(clientId, token, cfg.ttsVoice);
    console.log(`[CALLS/voice] Responding with TwiML:\n${twiml}`);
    return res.send(twiml);
  } catch (e) {
    console.error('[CALLS/voice] ERROR:', e.message, e.stack);
    return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }
}

/**
 * POST /api/calls/webhook/gather — called after each <Gather> (caller spoke or timed out).
 */
async function handleGatherWebhook(req, res) {
  res.type('text/xml');
  const clientId = req.query.client_id;
  console.log(`[CALLS/gather] clientId=${clientId} empty=${req.query.empty} body=`, JSON.stringify(req.body));

  if (!clientId) {
    console.warn('[CALLS/gather] No client_id — hanging up');
    return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }

  const { CallSid, SpeechResult } = req.body;
  const isEmpty = req.query.empty === '1' || !SpeechResult?.trim();
  console.log(`[CALLS/gather] CallSid=${CallSid} SpeechResult="${SpeechResult}" isEmpty=${isEmpty}`);

  let cfg;
  try {
    cfg = await loadCallConfig(clientId);
    if (!cfg) {
      console.warn(`[CALLS/gather] Addon not enabled for client=${clientId}`);
      return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
    }

    if (isEmpty) {
      console.log('[CALLS/gather] No speech — sending reprompt');
      return res.send(repromptTwiML(clientId, cfg.ttsVoice));
    }

    const callerText = SpeechResult.trim();
    console.log(`[CALLS/gather] Caller said: "${callerText}"`);

    await db.appendTranscriptTurn(CallSid, 'caller', callerText);

    const callRow = await db.getCall(CallSid, clientId);
    const transcript = callRow?.transcript || [];
    console.log(`[CALLS/gather] Transcript length: ${transcript.length} turns`);

    const geminiTranscript = transcript.length > 0 ? transcript : [{ speaker: 'caller', text: callerText }];

    console.log('[CALLS/gather] Calling Gemini...');
    const aiText = await geminiCallReply(cfg.systemPrompt, geminiTranscript, cfg.geminiApiKey);
    console.log(`[CALLS/gather] Gemini replied: "${aiText}"`);

    await db.appendTranscriptTurn(CallSid, 'ai', aiText);

    console.log('[CALLS/gather] Synthesizing AI reply via TTS...');
    const audioBuffer = await synthesizeSpeech(aiText, cfg.ttsVoice);
    console.log(`[CALLS/gather] TTS OK — audio size=${audioBuffer.length} bytes`);

    const token = cacheAudio(audioBuffer);
    const audioUrl = `${BASE_URL}/api/calls/audio/${token}`;
    console.log(`[CALLS/gather] Audio cached at: ${audioUrl}`);

    const twiml = gatherTwiML(clientId, token, cfg.ttsVoice);
    console.log(`[CALLS/gather] Responding with TwiML:\n${twiml}`);
    return res.send(twiml);
  } catch (e) {
    console.error('[CALLS/gather] ERROR:', e.message, e.stack);
    return res.send(repromptTwiML(clientId, cfg?.ttsVoice));
  }
}

/**
 * POST /api/calls/webhook/status — Twilio status callback on call completion.
 */
async function handleStatusWebhook(req, res) {
  const { CallSid, CallStatus, CallDuration } = req.body;
  const clientId = req.query.client_id;

  try {
    const status = CallStatus || 'completed';
    const duration = CallDuration ? parseInt(CallDuration, 10) : null;
    const endedAt = new Date().toISOString();

    await db.updateCallStatus(CallSid, status, duration, endedAt);

    // Generate AI summary in the background if call completed with transcript
    if (status === 'completed' && clientId) {
      (async () => {
        try {
          const callRow = await db.getCall(CallSid, clientId);
          if (!callRow || !callRow.transcript?.length) return;

          const cfg = await loadCallConfig(clientId);
          if (!cfg) return;

          const transcriptText = callRow.transcript
            .map(t => `${t.speaker === 'caller' ? 'Caller' : 'AI'}: ${t.text}`)
            .join('\n');

          const genAI = new GoogleGenerativeAI(cfg.geminiApiKey || process.env.GEMINI_API_KEY);
          const summaryModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
          const result = await summaryModel.generateContent(
            `Summarize this phone call transcript in 2-3 sentences. Focus on what the caller wanted and how it was resolved.\n\nTranscript:\n${transcriptText}`
          );
          const summary = result.response.text().trim();
          await db.updateCallSummary(CallSid, summary);
        } catch (err) {
          console.error('[CALLS] summary generation error:', err.message);
        }
      })();
    }
  } catch (e) {
    console.error('[CALLS] status webhook error:', e.message);
  }

  res.sendStatus(200);
}

/**
 * GET /api/calls/audio/:token — serve cached TTS audio to Twilio <Play>.
 */
function serveAudio(req, res) {
  const { token } = req.params;
  const entry = audioCache.get(token);
  if (!entry || Date.now() > entry.expiresAt) {
    audioCache.delete(token);
    return res.status(404).send('Audio not found or expired');
  }
  res.type('audio/mpeg');
  res.send(entry.buffer);
}

// ─── CRM endpoints ────────────────────────────────────────────────────────────

/**
 * GET /api/calls — paginated call log for the current client.
 */
async function listCallsHandler(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  const page     = parseInt(req.query.page, 10)  || 1;
  const limit    = parseInt(req.query.limit, 10) || 20;
  const search   = req.query.search   || '';
  const status   = req.query.status   || '';
  const dateFrom = req.query.dateFrom || '';
  const dateTo   = req.query.dateTo   || '';

  try {
    const result = await db.listCalls(clientId, { page, limit, search, status, dateFrom, dateTo });
    res.json({ ...result, page, limit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /api/calls/:callSid — single call with full transcript.
 */
async function getCallHandler(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { callSid } = req.params;
  try {
    const call = await db.getCall(callSid, clientId);
    if (!call) return res.status(404).json({ error: 'Call not found' });
    res.json({ call });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  handleVoiceWebhook,
  handleGatherWebhook,
  handleStatusWebhook,
  serveAudio,
  listCallsHandler,
  getCallHandler,
};
