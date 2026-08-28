/**
 * @module services/chunker
 * @description Splits documents for embedding.
 *
 * Two shapes are handled. An ordinary document is cut into overlapping
 * fixed-size pieces, which is the only sensible thing to do with prose whose
 * structure is unknown. A document that opens with a `## CHUNK ID:` line is one
 * topic, deliberately authored to stand alone, and is stored whole.
 */

'use strict';

/**
 * Tidy whitespace without flattening the text.
 *
 * This used to collapse every run of whitespace to a single space, newlines
 * included, so a knowledge chunk arrived as one unbroken paragraph. That is
 * fatal for an answer meant to be reproduced word for word: the bullets, the
 * blank lines and the shape of the message all vanished on upload, and nothing
 * in the CRM showed that it had happened.
 *
 * Runs of spaces and tabs still collapse. Line breaks survive, and three or
 * more collapse to two, so a paragraph break stays a paragraph break.
 *
 * @param {string} text
 * @returns {string}
 */
function normalise(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Split text into overlapping fixed-size chunks.
 *
 * A document naming itself with `## CHUNK ID:` is returned whole, however long
 * it runs. Splitting one would leave half an answer in each piece, and a chunk
 * carrying [NOTE: EXACT_RESPONSE] has to survive intact or the model copies out
 * a fragment.
 *
 * @param {string} text           - Input text to chunk
 * @param {number} [chunkSize]    - Target characters per chunk (default 1000)
 * @param {number} [overlap]      - Character overlap between adjacent chunks (default 150)
 * @returns {string[]} Array of text chunks
 */
function chunkText(text, chunkSize = 1000, overlap = 150) {
  if (/^\s*##\s*CHUNK ID:/i.test(String(text || ''))) {
    const whole = normalise(text);
    return whole ? [whole] : [];
  }

  const clean = normalise(text);
  if (!clean) return [];

  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + chunkSize, clean.length);
    // Try to end at a sentence boundary for cleaner semantic units. Sinhala
    // does not use a full stop, so this often will not fire — a paragraph
    // break is the better boundary when there is one.
    if (end < clean.length) {
      const para = clean.lastIndexOf('\n\n', end);
      const stop = clean.lastIndexOf('.', end);
      const boundary = Math.max(para, stop);
      if (boundary > start + chunkSize / 2) end = boundary + 1;
    }
    const chunk = clean.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= clean.length) break; // reached end — no overlap needed
    start = end - overlap;
    if (start >= clean.length) break;
  }
  return chunks;
}

module.exports = { chunkText, normalise };
