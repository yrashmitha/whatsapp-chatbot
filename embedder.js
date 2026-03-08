'use strict';
// ─── embedder.js ──────────────────────────────────────────────────────────────
// Google text-embedding-004 wrapper (768-dim, multilingual)
// Used to embed products at save time and customer queries at search time
// ─────────────────────────────────────────────────────────────────────────────

const EMBED_MODEL = 'gemini-embedding-001';

/**
 * Embed a text string → float[768] via direct REST call
 */
async function embedText(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: { parts: [{ text }] } }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Embed API error ${res.status}: ${JSON.stringify(data)}`);
  return data.embedding.values;
}

/**
 * Build searchable text from a product row.
 * Includes all attributes so custom fields (color, size, voltage, etc.) are searchable.
 */
function productToText(p) {
  const attrs = p.attributes
    ? (typeof p.attributes === 'string' ? p.attributes : JSON.stringify(p.attributes))
    : '';
  return [p.name, p.description, p.category, p.subcategory, p.sku, attrs]
    .filter(Boolean)
    .join(' ');
}

module.exports = { embedText, productToText };
