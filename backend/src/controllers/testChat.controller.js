/**
 * @module controllers/testChat.controller
 * @description A sandbox for exercising a client's bot without touching WhatsApp.
 *
 * Ported from the wwjs service. Runs the real chat pipeline — the same
 * buildChatSession, the same handleMessage, the same tools — against a
 * throwaway `web:<sessionId>` customer, so what you see is what a customer
 * would get. A mock would prove nothing.
 *
 * Its reason for existing: since report prompts no longer have built-in
 * defaults, every new client writes theirs from scratch. Iterating on a prompt
 * by generating real reports is slow, costs a call on the client's key, and
 * mutates order data. This costs a message.
 */

'use strict';

const db = require('../db');
const clientRouter = require('../services/clientRouter');
const resolveClientId = require('../middleware/resolveClientId');
const { buildChatSession, handleMessage } = require('../services/gemini');
const { chatSessions } = require('../workers/sessionManager');
const { extractFromBuffer } = require('../services/mediaExtractor');
const { getGeminiKey } = require('../services/clientKeys');

/** Test conversations are stored against this customer-key prefix. */
const TEST_PREFIX = 'web:';

/**
 * The phone key a test session writes under.
 *
 * Prefixed so test traffic is never mistaken for a real customer in the CRM,
 * in exports, or in the income summary.
 *
 * @param {string} sessionId
 * @returns {string}
 */
function phoneKeyFor(sessionId) {
  return `${TEST_PREFIX}${sessionId}`;
}

/**
 * Reject a session id that could escape the test namespace.
 *
 * @param {string} sessionId
 * @returns {boolean}
 */
function validSessionId(sessionId) {
  return typeof sessionId === 'string' && /^test_[A-Za-z0-9_-]{1,64}$/.test(sessionId);
}

/**
 * The messages of the latest turn, newest turn last.
 *
 * @param {string} phoneKey
 * @param {string} clientId
 * @returns {Promise<Array>}
 */
async function recentMessages(phoneKey, clientId) {
  const { rows } = await db.pgQuery(
    `SELECT sender_type, message_text, media_type, media_url, created_at
       FROM messages WHERE phone_number=$1 AND client_id=$2
      ORDER BY id ASC LIMIT 100`,
    [phoneKey, clientId]
  );
  return rows;
}

/**
 * POST /api/test-chat/:sessionId/message — send one message as a test customer.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function sendTestMessage(req, res) {
  const clientId = resolveClientId(req);
  const { sessionId } = req.params;
  const { message } = req.body || {};

  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid test session id' });
  if (!message || !message.trim()) return res.status(400).json({ error: 'message required' });

  const phoneKey   = phoneKeyFor(sessionId);
  const sessionKey = `${clientId}:${phoneKey}`;

  try {
    const client = await clientRouter.getClientById(clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    // A draft prompt applies to test sessions only, so a prompt can be tried
    // against real behaviour without changing what customers receive.
    const { rows } = await db.pgQuery(
      `SELECT test_system_prompt FROM client_configs WHERE client_id=$1`, [clientId]
    );
    const testPrompt = (rows[0]?.test_system_prompt || '').trim();
    const effectiveClient = testPrompt ? { ...client, custom_prompt: testPrompt } : client;
    if (testPrompt) console.log(`[TEST-CHAT] draft prompt active for ${clientId} (${testPrompt.length} chars)`);

    await db.upsertCustomer(phoneKey, 'Test Session', clientId);

    if (!chatSessions.has(sessionKey)) {
      chatSessions.set(sessionKey, {
        chat: await buildChatSession(phoneKey, effectiveClient),
        phoneNumber: phoneKey,
      });
    }
    const session = chatSessions.get(sessionKey);

    const result = await handleMessage(phoneKey, message.trim(), session.chat, {
      client: effectiveClient,
      skipUserInsert: false,
      traceId: sessionId,
    });

    // Everything the debug panel needs about the turn that just ran.
    const order = await db.pgQuery(
      `SELECT order_id, status, custom_fields FROM orders
        WHERE phone_number=$1 AND client_id=$2 ORDER BY created_at DESC LIMIT 1`,
      [phoneKey, clientId]
    ).then(r => r.rows[0] || null).catch(() => null);

    res.json({
      reply:    result.botReply || '',
      fallback: !!result.isFallback,
      images:   result.imagesToSend || [],
      messages: await recentMessages(phoneKey, clientId),
      debug: {
        draftPromptActive: !!testPrompt,
        promptChars:       (effectiveClient.custom_prompt || '').length,
        model:             effectiveClient.ai_model || 'gemini-2.5-flash',
        toolCalls:         result.toolCalls || [],
        inputTokens:       result.inputTokens ?? null,
        outputTokens:      result.outputTokens ?? null,
        costUSD:           result.callCostUSD ?? null,
        fallback:          !!result.isFallback,
        order: order && {
          orderId: order.order_id,
          status:  order.status,
          fields:  order.custom_fields || {},
        },
      },
    });
  } catch (e) {
    console.error('[TEST-CHAT] send error:', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

/**
 * GET /api/test-chat/:sessionId/messages — the transcript so far.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function getTestMessages(req, res) {
  const clientId = resolveClientId(req);
  const { sessionId } = req.params;
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid test session id' });

  try {
    res.json(await recentMessages(phoneKeyFor(sessionId), clientId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * DELETE /api/test-chat/:sessionId — discard a test conversation.
 *
 * Removes the in-memory session and the stored messages, so the next message
 * starts from a clean history rather than inheriting the previous experiment.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function resetTestSession(req, res) {
  const clientId = resolveClientId(req);
  const { sessionId } = req.params;
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid test session id' });

  const phoneKey = phoneKeyFor(sessionId);
  try {
    chatSessions.delete(`${clientId}:${phoneKey}`);
    // Scoped to the test key and this client, so it can only ever clear a
    // sandbox conversation.
    await db.pgQuery('DELETE FROM messages WHERE phone_number=$1 AND client_id=$2', [phoneKey, clientId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET/POST /api/test-chat/config — read or set the draft system prompt.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function testConfig(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  try {
    if (req.method === 'GET') {
      const { rows } = await db.pgQuery(
        `SELECT test_system_prompt FROM client_configs WHERE client_id=$1`, [clientId]
      );
      return res.json({ test_system_prompt: rows[0]?.test_system_prompt || '' });
    }
    const prompt = (req.body?.system_prompt || '').trim();
    await db.pgQuery(
      `UPDATE client_configs SET test_system_prompt=$1, updated_at=NOW() WHERE client_id=$2`,
      [prompt || null, clientId]
    );
    res.json({ ok: true, active: !!prompt });
  } catch (e) {
    console.error('[TEST-CHAT] config error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /api/test-chat/extract — run a file through the client's extraction
 * prompt and show exactly what comes back.
 *
 * Lets the extraction prompt be tuned against a real payment slip without
 * anyone having to send one over WhatsApp.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function testExtract(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const cfg = await db.getPluginConfig(clientId, 'media_extractor');
    const apiKey = await getGeminiKey(clientId);

    const { text, mediaType } = await extractFromBuffer(
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname,
      cfg.prompt || null,
      apiKey
    );

    let parsed = null;
    if (text) {
      const body = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      try { parsed = JSON.parse(body); } catch { parsed = null; }
    }

    res.json({ filename: req.file.originalname, mediaType, text: text || '', parsed });
  } catch (e) {
    console.error('[TEST-CHAT] extract error:', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

module.exports = {
  sendTestMessage,
  getTestMessages,
  resetTestSession,
  testConfig,
  testExtract,
};
