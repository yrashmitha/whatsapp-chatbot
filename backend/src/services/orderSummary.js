'use strict';

/**
 * The internal note on an order ("AI summary"), for orders the bot did not place.
 *
 * When the bot places an order it writes this note itself, from the
 * conversation it just had. An order an operator types in has no such moment,
 * so it used to arrive with no summary at all, and the team opening it saw an
 * empty box for exactly the customers they had to handle by hand. This writes
 * the same kind of note from the chat and the details the operator entered.
 */

const db = require('../db');
const { getGenAI } = require('./clientKeys');
const { formatChatLog } = require('../utils/chatLog');

/** How much of the chat is read. The newest messages say what is wanted now. */
const CHAT_WINDOW = 60;

/**
 * Write and store the summary for a manually created order.
 *
 * Never throws into the caller's request: the order already exists and a
 * missing summary is a nuisance, not a failure. Leaves an existing summary
 * alone, so a note somebody wrote is never replaced.
 *
 * @param {string|null} clientId
 * @param {string} phone
 * @param {string} orderId
 * @param {{customFields?: object, notes?: string}} [entered] what the operator typed
 * @returns {Promise<string|null>} the summary, or null when none was written
 */
async function generateOrderSummary(clientId, phone, orderId, entered = {}) {
  try {
    const existing = await db.pgQuery('SELECT ai_summary FROM orders WHERE order_id=$1', [orderId]);
    if (existing.rows[0]?.ai_summary) return null;

    const chatLog = formatChatLog((await db.getMessagesByPhone(phone, clientId)).slice(-CHAT_WINDOW));
    const details = Object.entries(entered.customFields || {})
      .filter(([, v]) => v != null && String(v).trim() && String(v).trim() !== 'N/A')
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join('\n');

    const prompt = `You write the short internal note a team reads when they open an order. Customers never see it.

This order was typed in by a team member, not placed by the bot. Write 1 to 3 plain sentences covering: what the customer wants, which service or package and what was said about payment, and anything unusual or urgent (a missing detail, a deadline, a worry). Use only facts that appear below. Do not invent, and do not repeat the whole form.

Write in English unless the chat is mostly Sinhala, in which case write in Sinhala. Return the note only, no heading and no quotes.

Details the team member entered:
${details || '(none)'}

Team member's note: ${entered.notes ? entered.notes : '(none)'}

Recent chat:
${chatLog || '(no messages found)'}`;

    const model = (await getGenAI(clientId)).getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0.2 },
    });
    const r = await model.generateContent(prompt);
    const summary = r.response.text().trim().replace(/^["']|["']$/g, '').slice(0, 1200);
    if (!summary) return null;

    await db.updateOrderAISummary(orderId, summary);
    console.log(`[ORDER-SUMMARY] wrote a summary for manual order ${orderId}`);
    return summary;
  } catch (e) {
    console.warn(`[ORDER-SUMMARY] could not summarise ${orderId}:`, e.message);
    return null;
  }
}

module.exports = { generateOrderSummary };
