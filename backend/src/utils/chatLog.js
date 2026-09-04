/**
 * @module utils/chatLog
 * @description Render a message list as a plain-text transcript for an AI prompt,
 * folding in what was extracted from media (a transcribed voice note, a read
 * payment slip, a document's text) so the model sees the actual content instead
 * of a bare "[Voice message]" placeholder.
 */

'use strict';

function parseExtracted(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

/** One transcript line for a message. */
function lineFor(m) {
  const who = m.sender_type === 'user' ? 'Customer' : 'Agent';
  let body = (m.message_text || '').trim();

  const ex = parseExtracted(m.extracted);
  if (ex) {
    const text = (ex.text || ex.transcription || ex.raw_text || '').trim();
    if (m.media_type === 'audio' && text) {
      body = `(voice message) ${text}`;
    } else if (text) {
      body = body ? `${body}\n(attachment content: ${text})` : `(attachment content: ${text})`;
    } else if (ex.amount || ex.bank) {
      body = `${body} (payment slip — amount: ${ex.amount || '?'}, bank: ${ex.bank || '?'})`.trim();
    }
  }
  return `[${who}]: ${body}`;
}

/**
 * @param {Array} messages - rows from getMessagesByPhone (need sender_type,
 *   message_text, media_type, extracted)
 * @param {number} [minLen=12] - drop lines shorter than this (empty acks etc.)
 * @returns {string}
 */
function formatChatLog(messages, minLen = 12) {
  return (messages || [])
    .map(lineFor)
    .filter(l => l.length > minLen)
    .join('\n');
}

module.exports = { formatChatLog };
