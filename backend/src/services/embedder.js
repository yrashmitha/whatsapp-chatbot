/**
 * @module services/embedder
 * @description Google text-embedding wrapper (768-dim, multilingual).
 * Used to embed products at save time and customer queries at search time.
 * Moved from backend/embedder.js — no path changes needed.
 */

'use strict';

const EMBED_MODEL = 'gemini-embedding-001';

/**
 * Embed a text string into a float[768] vector via the Gemini REST API.
 *
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} 768-dimensional embedding vector
 */
async function embedText(text) {
  // Platform-level: knowledge-base embeddings are our infrastructure, not client
  // work, so this deliberately uses the platform key rather than a client's.
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: { parts: [{ text }] }, outputDimensionality: 768 }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Embed API error ${res.status}: ${JSON.stringify(data)}`);
  return data.embedding.values;
}

/**
 * Build searchable text from a product row.
 * Includes all attributes so custom fields (color, size, voltage, etc.) are searchable.
 *
 * @param {Object} p            - Product row or body
 * @param {string} [p.name]        - Product name
 * @param {string} [p.description] - Product description
 * @param {string} [p.category]    - Product category
 * @param {string} [p.subcategory] - Product subcategory
 * @param {string} [p.sku]         - Stock-keeping unit
 * @param {string|Object} [p.attributes] - Attributes object or JSON string
 * @returns {string} Concatenated searchable text
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
