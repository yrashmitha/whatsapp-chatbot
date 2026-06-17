/**
 * @module services/mediaExtractor
 * @description Generic media → text extraction via Gemini. Ported from wwjs-service
 * (Baileys-free path only). Turns an uploaded image / PDF / audio / docx into a plain
 * structured text summary that can be fed into the chat as the customer's "message".
 * Complements imageAnalysis.js (which is aura/payment-slip specific).
 */

'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

const DEFAULT_EXTRACTION_PROMPT = `You are a data extraction assistant for a WhatsApp chatbot.
Analyse the attached media and extract ALL useful information.

For a document or CV: extract name, contact details, job title, skills, years of experience, certifications, education, countries worked in, languages, and any other relevant details.

For a certificate, ID, or work photo: describe what it shows and extract any visible text, credentials, issuing authority, or relevant details.

For a voice message or audio: first transcribe exactly what was said, then list any key details mentioned (job, experience, requests, preferences, etc.).

Return a clear, structured plain-text summary. Be thorough — miss nothing useful.`;

/** Prepend an authoritative SLST reference date so date reasoning is consistent. */
function _buildPrompt(customPrompt) {
  const base   = (customPrompt && customPrompt.trim()) ? customPrompt.trim() : DEFAULT_EXTRACTION_PROMPT;
  const slDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' });
  const slTime = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit' });
  return `⚠️ REFERENCE DATE/TIME: Today is ${slDate} at ${slTime} Sri Lanka Standard Time (Asia/Colombo). Use this as the authoritative reference for ALL date comparisons.\n\n${base}`;
}

/**
 * Extract content from a raw Buffer (direct upload — no Baileys).
 * Returns the extracted text wrapped so the model sees it as the customer's input.
 *
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {string} filename
 * @param {Object} [opts]
 * @param {string} [opts.apiKey]       - Gemini API key (defaults to env)
 * @param {string} [opts.customPrompt] - Per-client extraction prompt
 * @returns {Promise<{text: string|null, mediaType: string|null}>}
 */
async function extractFromBuffer(buffer, mimeType, filename, { apiKey, customPrompt } = {}) {
  const prompt    = _buildPrompt(customPrompt);
  const lower     = (filename || '').toLowerCase();
  const cleanMime = (mimeType || 'application/octet-stream').split(';')[0].trim();
  const genai     = new GoogleGenerativeAI(apiKey || process.env.GEMINI_API_KEY);
  const model     = genai.getGenerativeModel({ model: 'gemini-2.5-flash' });

  // Word documents: extract raw text first (Gemini can't read .docx binary directly).
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
    let mammoth;
    try { mammoth = require('mammoth'); } catch { return { text: `[Customer sent a document (${filename}) — .docx extraction unavailable]`, mediaType: 'document' }; }
    const { value: rawText } = await mammoth.extractRawText({ buffer });
    if (!rawText.trim()) return { text: null, mediaType: 'document' };
    const result = await model.generateContent([
      prompt + '\n\nThe following is plain text extracted from a Word document:',
      rawText,
    ]);
    const extracted = result.response.text().trim();
    return {
      text: extracted
        ? `[Customer sent a document (${filename}). Extracted content:\n${extracted}]`
        : `[Customer sent a document (${filename}). Raw text:\n${rawText.slice(0, 800)}]`,
      mediaType: 'document',
    };
  }

  const mediaType = cleanMime.startsWith('audio/') ? 'audio'
    : cleanMime.startsWith('image/') ? 'image'
    : cleanMime === 'application/pdf' ? 'pdf'
    : 'document';
  const label = mediaType === 'audio' ? 'voice message'
    : mediaType === 'image' ? 'image or photo'
    : `document (${filename})`;

  const result = await model.generateContent([
    prompt,
    { inlineData: { mimeType: cleanMime, data: buffer.toString('base64') } },
  ]);
  const extracted = result.response.text().trim();
  return {
    text: extracted ? `[Customer sent a ${label}. Extracted content:\n${extracted}]` : null,
    mediaType,
  };
}

module.exports = { extractFromBuffer, DEFAULT_EXTRACTION_PROMPT, _buildPrompt };
