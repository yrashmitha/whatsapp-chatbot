'use strict';

/**
 * @module services/followup
 * @description Follow-up message generation service.
 * Reads the full conversation history for a customer and passes it to Gemini,
 * along with a client-configured prompt, to draft a follow-up message that a
 * CRM agent can review and send. Ported from wwjs-service.
 */

const db = require('../db');
const { getGenAI } = require('./clientKeys');

const DEFAULT_FOLLOWUP_PROMPT = `You are a friendly customer support agent. Based on the conversation history below, write a short, natural follow-up message to re-engage the customer. Reference where the conversation left off, keep it warm and concise (1-3 sentences), and match the language the customer was using. Reply with the message text only — no labels, quotes, or preamble.`;

function buildTranscript(messages) {
  return messages
    .filter(m => m.message_text && m.message_text.trim())
    .map(m => `${m.sender_type === 'user' ? 'Customer' : 'Agent'}: ${m.message_text.trim()}`)
    .join('\n');
}

/**
 * Generate a follow-up message for a customer using their conversation history.
 *
 * @param {string} clientId - Multi-tenant client ID
 * @param {string} phone    - Customer phone number
 * @returns {Promise<string>} Generated follow-up message text
 */
async function generateFollowUp(clientId, phone) {
  const config = await db.getPluginConfig(clientId, 'follow_up_generator');
  const promptTemplate = config.prompt || DEFAULT_FOLLOWUP_PROMPT;

  const messages = await db.getMessagesByPhone(phone, clientId);
  const transcript = buildTranscript(messages);
  if (!transcript) {
    throw new Error('No conversation history to base a follow-up on.');
  }

  const prompt = `${promptTemplate}\n\nConversation history:\n${transcript}`;

  const followUpModel = (await getGenAI(clientId)).getGenerativeModel({ model: 'gemini-2.5-flash' });
  const result = await followUpModel.generateContent(prompt);
  return result.response.text().trim();
}

module.exports = { DEFAULT_FOLLOWUP_PROMPT, generateFollowUp };
