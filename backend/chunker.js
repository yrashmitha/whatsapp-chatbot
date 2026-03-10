/**
 * Fixed-size text chunker with overlap.
 * Works for any text format regardless of structure.
 */
function chunkText(text, chunkSize = 600, overlap = 100) {
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
