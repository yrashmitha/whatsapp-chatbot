/**
 * @module services/quickReplyBlocks
 * @description Letting the prompt name a block instead of containing it.
 *
 * A service pitch is nine hundred characters of carefully worded Sinhala that
 * the client edits regularly. Pasting it into the system prompt means it lives
 * in two places, and within a day of pj rewriting their quick replies the
 * prompt was still sending the previous draft, prices and all.
 *
 * So the prompt writes [[QR:2990]] and the words are looked up when the message
 * is built. The client edits one quick reply and both the operator and the bot
 * send the same thing, which is the point.
 */

'use strict';

const db = require('../db');

/** @type {RegExp} Matches [[QR:title]], where a title may contain a dash. */
const QR_REGEX = /\[\[QR:([a-z0-9_-]+)\]\]/gi;

/**
 * Replace every [[QR:title]] in a reply with the quick reply it names.
 *
 * A title that does not exist is removed and reported rather than left in the
 * text, because a customer seeing "[[QR:2990]]" is worse than a short message.
 * The caller decides what to do when nothing is left.
 *
 * @param {string} clientId
 * @param {string} text
 * @returns {Promise<{text: string, used: string[], missing: string[]}>}
 */
async function resolveBlocks(clientId, text) {
  if (!text || !clientId) return { text: text || '', used: [], missing: [] };

  const wanted = [...new Set([...text.matchAll(QR_REGEX)].map(m => m[1].toLowerCase()))];
  if (!wanted.length) return { text, used: [], missing: [] };

  const { rows } = await db.pgQuery(
    'SELECT title, text FROM quick_replies WHERE client_id=$1 AND LOWER(title) = ANY($2)',
    [clientId, wanted]
  );
  const byTitle = new Map(rows.map(r => [r.title.toLowerCase(), r.text]));

  // A block sitting directly under a line of the model's own text should be
  // separated from it by a blank line, or the block's heading butts straight
  // against that sentence.
  const spaced = text.replace(/([^\n])\n(\[\[QR:[a-z0-9_-]+\]\])/gi, '$1\n\n$2');

  const used = [];
  const missing = [];
  const out = spaced.replace(QR_REGEX, (_, rawTitle) => {
    const title = rawTitle.toLowerCase();
    const body = byTitle.get(title);
    if (body === undefined) {
      missing.push(title);
      return '';
    }
    used.push(title);
    return body;
  });

  return { text: out.replace(/\n{3,}/g, '\n\n').trim(), used, missing };
}

/**
 * The block names a client actually has, for telling the model what exists.
 *
 * @param {string} clientId
 * @returns {Promise<string[]>}
 */
async function listBlockNames(clientId) {
  const { rows } = await db.pgQuery(
    'SELECT title FROM quick_replies WHERE client_id=$1 ORDER BY title', [clientId]);
  return rows.map(r => r.title);
}

module.exports = { resolveBlocks, listBlockNames, QR_REGEX };
