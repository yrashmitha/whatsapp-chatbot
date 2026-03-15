/**
 * @module services/chunker
 * @description Fixed-size text chunker with overlap.
 * Works for any text format regardless of structure.
 * Moved from backend/chunker.js — no path changes needed.
 */

'use strict';

/**
 * Split text into overlapping fixed-size chunks.
 * Attempts to break at sentence boundaries for cleaner semantic units.
 *
 * @param {string} text           - Input text to chunk
 * @param {number} [chunkSize]    - Target characters per chunk (default 1000)
 * @param {number} [overlap]      - Character overlap between adjacent chunks (default 150)
 * @returns {string[]} Array of text chunks
 */
function chunkText(text, chunkSize = 1000, overlap = 150) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + chunkSize, clean.length);
    // Try to end at a sentence boundary for cleaner semantic units
    if (end < clean.length) {
      const boundary = clean.lastIndexOf('.', end);
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

module.exports = { chunkText };
