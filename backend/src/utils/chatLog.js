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

/** "2026-11-05 14:32" in Sri Lanka time, or '' when the row has no usable date. */
function stamp(m) {
  const d = m.created_at ? new Date(m.created_at) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).reduce((o, x) => ({ ...o, [x.type]: x.value }), {});
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

/** One transcript line for a message. */
function lineFor(m, withTime = false) {
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
  const at = withTime ? stamp(m) : '';
  return `[${at ? `${at} ` : ''}${who}]: ${body}`;
}

/**
 * @param {Array} messages - rows from getMessagesByPhone (need sender_type,
 *   message_text, media_type, extracted)
 * @param {number} [minLen=12] - drop lines shorter than this (empty acks etc.)
 * @param {{ withTime?: boolean }} [opts] - prefix each line with its date and time
 * @returns {string}
 */
function formatChatLog(messages, minLen = 12, opts = {}) {
  return (messages || [])
    .map(m => lineFor(m, !!opts.withTime))
    .filter(l => l.length > minLen)
    .join('\n');
}

module.exports = { formatChatLog };
