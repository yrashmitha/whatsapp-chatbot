/**
 * @module controllers/webchat.controller
 * @description CRM test-chat endpoints. An operator QA tool that drives the REAL
 * Gemini pipeline (buildChatSession + handleMessage) exactly like a WhatsApp
 * conversation, so behaviour can be validated before it reaches customers.
 *
 * Test visitors are identified by a session id prefixed with "web:" in the DB.
 * All endpoints are JWT-protected (internal tool) — see plugins/webchat routes.
 */

'use strict';

const fs = require('fs');
const db = require('../db');
const { chatSessions } = require('../workers/sessionManager');
const { buildChatSession, handleMessage } = require('../services/gemini');
const { extractFromBuffer } = require('../services/mediaExtractor');
const clientRouter = require('../services/clientRouter');
const resolveClientId = require('../middleware/resolveClientId');

/** Build (or reuse) the cached chat session for a web test session. */
async function getOrBuildSession(clientId, phoneKey, client) {
  const sessionKey = `${clientId}:${phoneKey}`;
  if (!chatSessions.has(sessionKey)) {
    chatSessions.set(sessionKey, {
      chat: await buildChatSession(phoneKey, client),
      phoneNumber: phoneKey,
    });
  }
  const session = chatSessions.get(sessionKey);
  session.lastUsed = Date.now();
  return session;
}

/**
 * POST /api/plugins/webchat/:sessionId/message — run a test message through Gemini.
 */
async function handleWebMessage(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const message = (req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'message required' });

  const { sessionId } = req.params;
  const phoneKey = `web:${sessionId}`;
  try {
    const client = await clientRouter.getClientById(clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    await db.upsertCustomer(phoneKey, 'Test Chat', clientId);
    const session = await getOrBuildSession(clientId, phoneKey, client);
    const result = await handleMessage(phoneKey, message, session.chat, { client });
    return res.json({ reply: result.botReply || null, isFallback: result.isFallback || false });
  } catch (e) {
    console.error('[webchat] handleWebMessage error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

/**
 * GET /api/plugins/webchat/:sessionId/messages — full transcript for a test session.
 */
async function getWebMessages(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { sessionId } = req.params;
  const phoneKey = `web:${sessionId}`;
  try {
    const messages = await db.getMessagesByPhone(phoneKey, clientId);
    return res.json({ messages });
  } catch (e) {
    console.error('[webchat] getWebMessages error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

/**
 * POST /api/plugins/webchat/:sessionId/reset — clear a test session's history.
 */
async function resetWebSession(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { sessionId } = req.params;
  const phoneKey = `web:${sessionId}`;
  try {
    chatSessions.delete(`${clientId}:${phoneKey}`);
    await db.pgQuery('DELETE FROM messages WHERE phone_number=$1 AND client_id=$2', [phoneKey, clientId]);
    return res.json({ ok: true });
  } catch (e) {
    console.error('[webchat] resetWebSession error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

/**
 * POST /api/plugins/webchat/:sessionId/media — upload an image/PDF/audio/doc, extract
 * its content via Gemini, then feed the extracted text through the chat pipeline.
 */
async function handleWebMedia(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { sessionId } = req.params;
  const phoneKey = `web:${sessionId}`;
  const { buffer, originalname, mimetype } = req.file;

  try {
    const client = await clientRouter.getClientById(clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Optional per-client extraction prompt from the media_extraction plugin config.
    let customPrompt = null;
    try {
      const cfg = await db.getPluginConfig(clientId, 'media_extraction');
      customPrompt = cfg?.extraction_prompt || null;
    } catch (_) { /* optional */ }

    const apiKey = client.gemini_api_key || process.env.GEMINI_API_KEY;
    const { text: extractedText } = await extractFromBuffer(buffer, mimetype, originalname, { apiKey, customPrompt });
    const message = extractedText || `[Customer sent a file: ${originalname}]`;

    await db.upsertCustomer(phoneKey, 'Test Chat', clientId);
    const session = await getOrBuildSession(clientId, phoneKey, client);
    const result = await handleMessage(phoneKey, message, session.chat, { client });
    return res.json({ reply: result.botReply || null, extracted: message });
  } catch (e) {
    console.error('[webchat:media]', e.message);
    return res.status(500).json({ error: e.message });
  }
}

module.exports = { handleWebMessage, getWebMessages, resetWebSession, handleWebMedia };
