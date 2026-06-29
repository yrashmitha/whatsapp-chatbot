'use strict';

/**
 * @module services/mediaExtractor
 * @description Gemini-powered media extraction for customer-sent images, audio, and documents.
 * Ported from wwjs-service. This version is buffer-based — the Meta Cloud API webhook
 * path already downloads the media buffer before calling here, so no Baileys download step.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

const DEFAULT_EXTRACTION_PROMPT = `You are a data extraction assistant for a WhatsApp chatbot.
Analyse the attached media and extract ALL useful information.

For a document or CV: extract name, contact details, job title, skills, years of experience, certifications, education, countries worked in, languages, and any other relevant details.

For a certificate, ID, or work photo: describe what it shows and extract any visible text, credentials, issuing authority, or relevant details.

For a voice message or audio: first transcribe exactly what was said, then list any key details mentioned (job, experience, requests, preferences, etc.).

Return a clear, structured plain-text summary. Be thorough — miss nothing useful.`;

function _buildPrompt(customPrompt) {
  const base   = (customPrompt && customPrompt.trim()) ? customPrompt.trim() : DEFAULT_EXTRACTION_PROMPT;
  const slDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' });
  const slTime = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit' });
  return `⚠️ REFERENCE DATE/TIME: Today is ${slDate} at ${slTime} Sri Lanka Standard Time (SLST / GMT+5:30 / Asia/Colombo). Use this as the authoritative reference for ALL date comparisons in this extraction.\n\n${base}`;
}

/**
 * Extract content from a raw Buffer using Gemini 2.5 Flash.
 * The buffer is already downloaded by the webhook controller — no Meta/Baileys step needed.
 *
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {string} filename
 * @param {string|null} [customPrompt] - Per-client extraction prompt override
 * @returns {Promise<{text:string|null, mediaType:string|null}>}
 */
async function extractFromBuffer(buffer, mimeType, filename, customPrompt) {
  const prompt    = _buildPrompt(customPrompt);
  const lower     = (filename || '').toLowerCase();
  const cleanMime = (mimeType || 'application/octet-stream').split(';')[0].trim();

  if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
    const mammoth = require('mammoth');
    const { value: rawText } = await mammoth.extractRawText({ buffer });
    if (!rawText.trim()) return { text: null, mediaType: 'document' };

    const genai   = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model   = genai.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result  = await model.generateContent([
      prompt + '\n\nThe following is plain text extracted from a Word document:',
      rawText,
    ]);
    const extracted = result.response.text().trim();
    const text = extracted
      ? `[Customer sent a document (${filename}). Extracted content:\n${extracted}]`
      : `[Customer sent a document (${filename}). Raw text:\n${rawText.slice(0, 800)}]`;
    return { text, mediaType: 'document' };
  }

  const mediaType = cleanMime.startsWith('audio/') ? 'audio'
    : cleanMime.startsWith('image/') ? 'image'
    : cleanMime === 'application/pdf' ? 'pdf'
    : 'document';

  const label = mediaType === 'audio' ? 'voice message'
    : mediaType === 'image' ? 'image or photo'
    : `document (${filename})`;

  const genai   = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model   = genai.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const result  = await model.generateContent([
    prompt,
    { inlineData: { mimeType: cleanMime, data: buffer.toString('base64') } },
  ]);
  const extracted = result.response.text().trim();
  const text = extracted
    ? `[Customer sent a ${label}. Extracted content:\n${extracted}]`
    : null;

  return { text, mediaType };
}

module.exports = { extractFromBuffer, DEFAULT_EXTRACTION_PROMPT, _buildPrompt };
