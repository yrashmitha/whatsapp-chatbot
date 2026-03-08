'use strict';
// ─── embedder.js ──────────────────────────────────────────────────────────────
// Google text-embedding-004 wrapper (768-dim, multilingual)
// Used to embed products at save time and customer queries at search time
// ─────────────────────────────────────────────────────────────────────────────

const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI    = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embModel = genAI.getGenerativeModel({ model: 'text-embedding-004' }, { apiVersion: 'v1' });

/**
 * Embed a text string → float[768]
 */
async function embedText(text) {
  const result = await embModel.embedContent(text);
  return result.embedding.values;
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
