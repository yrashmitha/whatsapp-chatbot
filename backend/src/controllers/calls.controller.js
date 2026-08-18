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
const { getGeminiKey } = require('../services/clientKeys');

// ─── PCM → WAV conversion ─────────────────────────────────────────────────────
/**
 * Wrap raw 16-bit little-endian PCM samples in a WAV container header.
 * Twilio <Play> accepts WAV; Gemini TTS returns raw PCM at 24kHz mono.
 */
function pcmToWav(pcmBuffer, sampleRate = 24000, numChannels = 1, bitDepth = 16) {
  const byteRate    = sampleRate * numChannels * (bitDepth / 8);
  const blockAlign  = numChannels * (bitDepth / 8);
  const dataSize    = pcmBuffer.length;
  const buffer      = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);           // PCM chunk size
  buffer.writeUInt16LE(1, 20);            // PCM format
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitDepth, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(buffer, 44);

  return buffer;
}

// ─── In-memory audio cache (token → { buffer, mime, expiresAt }) ─────────────
/** @type {Map<string, { buffer: Buffer, expiresAt: number }>} */
const audioCache = new Map();
const AUDIO_TTL_MS = 60_000; // 60 seconds

function cacheAudio(buffer, mime = 'audio/wav') {
  const token = uuidv4();
  audioCache.set(token, { buffer, mime, expiresAt: Date.now() + AUDIO_TTL_MS });
  setTimeout(() => audioCache.delete(token), AUDIO_TTL_MS + 1000);
  return token;
}

// ─── Silent WAV fallback ──────────────────────────────────────────────────────
/**
 * Returns a short silent WAV buffer so Twilio <Play> never gets a 404.
 * Used when all Gemini TTS retry attempts fail.
 */
function silentWav(durationMs = 500) {
  const sampleRate = 24000;
  const numSamples = Math.floor(sampleRate * durationMs / 1000);
  const pcm = Buffer.alloc(numSamples * 2, 0); // 16-bit zeros
  return pcmToWav(pcm, sampleRate);
}

// ─── Gemini TTS helper ────────────────────────────────────────────────────────
/**
 * Synthesize text to WAV audio using Gemini TTS API with retry.
 * Supports 100+ languages including Sinhala (si).
 * Retries up to MAX_ATTEMPTS times; returns silent WAV on all failures
 * so Twilio never drops the call due to a missing audio file.
 * @param {string} text - Text to synthesize
 * @param {string} voiceName - Gemini prebuilt voice name (e.g. 'Kore', 'Leda', 'Puck')
 * @param {string} [apiKey] - Optional API key override
 * @returns {Promise<Buffer>} WAV audio buffer
 */
async function synthesizeSpeech(text, voiceName = 'Kore', apiKey) {
  const key = apiKey;
  if (!key) {
    console.error('[TTS] no client Gemini API key supplied — returning silence');
    return silentWav();
  }

  const axios = require('axios');
  const body = {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  };

  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[TTS] Gemini TTS attempt ${attempt}/${MAX_ATTEMPTS} voice=${voiceName} text="${text.slice(0, 80)}"`);
    try {
      const resp = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${key}`,
        body,
        { headers: { 'Content-Type': 'application/json' } }
      );

      // Check for finishReason OTHER (safety/content filter — no audio returned)
      const candidate = resp.data?.candidates?.[0];
      const finishReason = candidate?.finishReason;
      if (finishReason && finishReason !== 'STOP') {
        console.warn(`[TTS] Attempt ${attempt} finishReason=${finishReason} — retrying`);
        if (attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, 500 * attempt));
          continue;
        }
        break;
      }

      const inlineData = candidate?.content?.parts?.[0]?.inlineData;
      if (!inlineData?.data) {
        console.warn(`[TTS] Attempt ${attempt} no inlineData — retrying. Response: ${JSON.stringify(resp.data).slice(0, 300)}`);
        if (attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, 500 * attempt));
          continue;
        }
        break;
      }

      console.log(`[TTS] Gemini TTS OK mimeType=${inlineData.mimeType} dataLength=${inlineData.data.length}`);
      const audioBuffer = Buffer.from(inlineData.data, 'base64');

      // Gemini TTS returns raw PCM (audio/pcm, 24kHz, 16-bit, mono)
      // Twilio <Play> requires WAV or MP3 — wrap PCM in a WAV header
      if (!inlineData.mimeType || inlineData.mimeType.includes('pcm') || inlineData.mimeType.includes('l16')) {
        console.log('[TTS] Converting PCM → WAV for Twilio compatibility');
        return pcmToWav(audioBuffer, 24000);
      }
      return audioBuffer;

    } catch (axiosErr) {
      const errData = axiosErr.response?.data;
      console.error(`[TTS] Attempt ${attempt} HTTP error:`, JSON.stringify(errData || axiosErr.message).slice(0, 300));
      if (attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 500 * attempt));
      }
    }
  }

  console.error('[TTS] All attempts failed — returning silent WAV so call continues');
  return silentWav();
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
  if (!apiKey) throw new Error('No Gemini API key supplied for call reply');
  const genAI = new GoogleGenerativeAI(apiKey);
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
    greeting:     config.greeting      || 'Hello, how can I help you today?',
    ttsVoice:     config.tts_voice     || 'Kore',       // Gemini prebuilt voice name
    sttLanguage:  config.stt_language  || 'en-US',      // Twilio <Gather> STT language code
    // Falls back to the client's own Gemini key, never the platform key.
    geminiApiKey: config.api_key       || await getGeminiKey(clientId),
  };
}

// ─── TwiML helpers ────────────────────────────────────────────────────────────
const BASE_URL = PUBLIC_URL || '';

function gatherTwiML(clientId, audioToken, sttLanguage) {
  const audioUrl     = `${BASE_URL}/api/calls/audio/${audioToken}`;
  const gatherAction = `${BASE_URL}/api/calls/webhook/gather?client_id=${encodeURIComponent(clientId)}`;
  const redirectUrl  = `${BASE_URL}/api/calls/webhook/gather?client_id=${encodeURIComponent(clientId)}&amp;empty=1`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" language="${sttLanguage || 'en-US'}" action="${gatherAction}" speechTimeout="3" timeout="15" actionOnEmptyResult="true">
    <Play>${audioUrl}</Play>
  </Gather>
  <Redirect>${redirectUrl}</Redirect>
</Response>`;
}

function repromptTwiML(clientId, sttLanguage) {
  const gatherAction = `${BASE_URL}/api/calls/webhook/gather?client_id=${encodeURIComponent(clientId)}`;
  const redirectUrl  = `${BASE_URL}/api/calls/webhook/gather?client_id=${encodeURIComponent(clientId)}&amp;empty=1`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" language="${sttLanguage || 'en-US'}" action="${gatherAction}" speechTimeout="3" timeout="15" actionOnEmptyResult="true">
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
    const audioBuffer = await synthesizeSpeech(cfg.greeting, cfg.ttsVoice, cfg.geminiApiKey);
    console.log(`[CALLS/voice] TTS OK — audio size=${audioBuffer.length} bytes`);

    const token = cacheAudio(audioBuffer);
    const audioUrl = `${BASE_URL}/api/calls/audio/${token}`;
    console.log(`[CALLS/voice] Audio cached at: ${audioUrl}`);

    const twiml = gatherTwiML(clientId, token, cfg.sttLanguage);
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
      return res.send(repromptTwiML(clientId, cfg.sttLanguage));
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
    const audioBuffer = await synthesizeSpeech(aiText, cfg.ttsVoice, cfg.geminiApiKey);
    console.log(`[CALLS/gather] TTS OK — audio size=${audioBuffer.length} bytes`);

    const token = cacheAudio(audioBuffer);
    const audioUrl = `${BASE_URL}/api/calls/audio/${token}`;
    console.log(`[CALLS/gather] Audio cached at: ${audioUrl}`);

    const twiml = gatherTwiML(clientId, token, cfg.sttLanguage);
    console.log(`[CALLS/gather] Responding with TwiML:\n${twiml}`);
    return res.send(twiml);
  } catch (e) {
    console.error('[CALLS/gather] ERROR:', e.message, e.stack);
    return res.send(repromptTwiML(clientId, cfg?.sttLanguage));
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

          const genAI = new GoogleGenerativeAI(cfg.geminiApiKey);
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
  console.log(`[AUDIO] GET token=${token} found=${!!entry}`);
  if (!entry || Date.now() > entry.expiresAt) {
    audioCache.delete(token);
    return res.status(404).send('Audio not found or expired');
  }
  console.log(`[AUDIO] Serving mime=${entry.mime} size=${entry.buffer.length}`);
  res.type(entry.mime);
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
