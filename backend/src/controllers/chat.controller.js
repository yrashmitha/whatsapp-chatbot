/**
 * @module controllers/chat.controller
 * @description Handler for the web UI chat endpoint (POST /chat).
 */

'use strict';

const { buildChatSession, handleMessage } = require('../services/gemini');
const { chatSessions } = require('../workers/sessionManager');
const { PUBLIC_URL } = require('../config/env');

/**
 * POST /chat — web UI chat endpoint.
 *
 * Accepts a message and sessionId, maintains an in-memory chat session,
 * returns the bot reply along with cost/token usage stats.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function chat(req, res) {
  const userMessage = req.body?.message?.trim();
  const sessionId   = req.body?.sessionId;
  const phoneNumber = req.body?.phoneNumber?.trim() || sessionId;

  console.log(`[/chat] session=${sessionId} phone=${phoneNumber} msg="${userMessage?.substring(0, 60)}"`);

  if (!userMessage) return res.status(400).json({ error: 'No message' });

  if (!chatSessions.has(sessionId)) {
    console.log(`[/chat] New session — building chat for ${phoneNumber}`);
    chatSessions.set(sessionId, {
      chat: await buildChatSession(phoneNumber),
      phoneNumber,
      totalCostUSD:      0,
      totalInputTokens:  0,
      totalOutputTokens: 0,
    });
  }

  const session = chatSessions.get(sessionId);
  session.lastUsed = Date.now();

  try {
    const { botReply, orderId, callCostUSD, inputTokens, outputTokens, imagesToSend } =
      await handleMessage(phoneNumber, userMessage, session.chat);

    session.totalCostUSD      += callCostUSD;
    session.totalInputTokens  += inputTokens;
    session.totalOutputTokens += outputTokens;

    console.log(`[/chat] Response sent | orderId=${orderId} | sessionTotal=$${session.totalCostUSD.toFixed(6)}`);

    const base = PUBLIC_URL || 'https://whatsapp-chatbot-production-038d.up.railway.app';
    res.json({
      reply: botReply,
      orderId,
      images: imagesToSend.map(f => ({ filename: f, url: `${base}/templates/${f}` })),
      usage: {
        callCostUSD:       +callCostUSD.toFixed(6),
        totalCostUSD:      +session.totalCostUSD.toFixed(6),
        totalInputTokens:  session.totalInputTokens,
        totalOutputTokens: session.totalOutputTokens,
      },
    });
  } catch (err) {
    console.error(`[/chat] ERROR:`, err.message);
    res.status(500).json({ error: 'Gemini error' });
  }
}

module.exports = { chat };
