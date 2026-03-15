/**
 * @module controllers/knowledge.controller
 * @description Handlers for the knowledge base API
 * (list sections, get chunks, add document, edit chunk, delete chunk/section).
 */

'use strict';

const db = require('../db');
const { embedText } = require('../services/embedder');
const { chunkText } = require('../services/chunker');
const resolveClientId = require('../middleware/resolveClientId');

/**
 * GET /api/knowledge — list document sections with chunk counts.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function listSections(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const sections = await db.getKnowledgeSections(clientId);
    res.json(sections);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * GET /api/knowledge/:title/chunks — list all chunks for a document title.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function getChunks(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const chunks = await db.getKnowledgeChunksByTitle(clientId, decodeURIComponent(req.params.title));
    res.json(chunks);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * POST /api/knowledge — add a document (chunk and embed).
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function addDocument(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'title and content are required' });
  try {
    const chunks = chunkText(content);
    if (!chunks.length) return res.status(400).json({ error: 'No content to embed' });
    const BATCH = 10;
    let total = 0;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      const embeddings = await Promise.all(batch.map(text => embedText(text)));
      await db.insertKnowledgeChunks(clientId, title, batch.map((content, j) => ({ content, embedding: embeddings[j] })));
      total += batch.length;
    }
    console.log(`[KNOWLEDGE] Added ${total} chunks for client ${clientId} title="${title}"`);
    res.json({ ok: true, chunks: total });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * PUT /api/knowledge/chunks/:id — edit a single chunk (re-embeds content).
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function updateChunk(req, res) {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required' });
  try {
    const embedding = await embedText(content);
    await db.updateKnowledgeChunk(parseInt(req.params.id), content, embedding);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * DELETE /api/knowledge/chunks/:id — delete a single knowledge chunk.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function deleteChunk(req, res) {
  try {
    await db.deleteKnowledgeChunk(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * DELETE /api/knowledge/:title — delete all chunks for a document title.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function deleteSection(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    await db.deleteKnowledgeByTitle(clientId, decodeURIComponent(req.params.title));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = { listSections, getChunks, addDocument, updateChunk, deleteChunk, deleteSection };
