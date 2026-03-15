/**
 * @module db/knowledge.db
 * @description Database access layer for the client_knowledge_chunks table.
 * Abstracts over PostgreSQL (production) and SQLite (local dev).
 * Most functions are PG-only (pgvector required for semantic search).
 */

'use strict';

const { pool, IS_PG } = require('./connection');

/**
 * Batch-insert knowledge chunks with their embeddings for a document title.
 * No-op on SQLite or when chunks is empty.
 *
 * @param {string} clientId - Multi-tenant client ID
 * @param {string} title    - Document / section title
 * @param {Array<{content: string, embedding: number[]}>} chunks - Chunk text + vector pairs
 * @returns {Promise<void>}
 */
async function insertKnowledgeChunks(clientId, title, chunks) {
  if (!IS_PG || !chunks.length) return;
  const values = [];
  const params = [];
  chunks.forEach(({ content, embedding }, i) => {
    const base = i * 4;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::vector)`);
    params.push(clientId, title, content, JSON.stringify(embedding));
  });
  await pool.query(
    `INSERT INTO client_knowledge_chunks (client_id, title, content, embedding) VALUES ${values.join(', ')}`,
    params
  );
}

/**
 * Vector (cosine similarity) search across knowledge chunks.
 * Returns an empty array on SQLite.
 *
 * @param {string}   clientId  - Multi-tenant client ID
 * @param {number[]} embedding - Query embedding vector (768 dimensions)
 * @param {number}   [limit]   - Maximum number of results
 * @returns {Promise<Array>} Array of chunk rows with similarity score
 */
async function vectorSearchKnowledge(clientId, embedding, limit = 5) {
  if (!IS_PG) return [];
  const res = await pool.query(
    `SELECT id, title, content, 1 - (embedding <=> $2::vector) AS similarity
     FROM client_knowledge_chunks
     WHERE client_id = $1 AND embedding IS NOT NULL
       AND (1 - (embedding <=> $2::vector)) > 0.35
     ORDER BY embedding <=> $2::vector
     LIMIT $3`,
    [clientId, JSON.stringify(embedding), limit]
  );
  return res.rows;
}

/**
 * Return distinct document sections (titles) with chunk counts for a client.
 *
 * @param {string} clientId - Multi-tenant client ID
 * @returns {Promise<Array>} Array of { title, chunk_count, created_at }
 */
async function getKnowledgeSections(clientId) {
  if (!IS_PG) return [];
  const res = await pool.query(
    `SELECT title, COUNT(*) AS chunk_count, MIN(created_at) AS created_at
     FROM client_knowledge_chunks WHERE client_id=$1
     GROUP BY title ORDER BY MIN(created_at)`,
    [clientId]
  );
  return res.rows;
}

/**
 * Return all chunks for a specific document title.
 *
 * @param {string} clientId - Multi-tenant client ID
 * @param {string} title    - Document title
 * @returns {Promise<Array>} Array of { id, content, created_at }
 */
async function getKnowledgeChunksByTitle(clientId, title) {
  if (!IS_PG) return [];
  const res = await pool.query(
    `SELECT id, content, created_at FROM client_knowledge_chunks
     WHERE client_id=$1 AND title=$2 ORDER BY id`,
    [clientId, title]
  );
  return res.rows;
}

/**
 * Update the content and re-embedding of a single knowledge chunk.
 *
 * @param {number}   id        - Chunk primary key
 * @param {string}   content   - New chunk text
 * @param {number[]} embedding - New embedding vector (768 dimensions)
 * @returns {Promise<void>}
 */
async function updateKnowledgeChunk(id, content, embedding) {
  if (!IS_PG) return;
  await pool.query(
    `UPDATE client_knowledge_chunks SET content=$1, embedding=$2::vector WHERE id=$3`,
    [content, JSON.stringify(embedding), id]
  );
}

/**
 * Delete a single knowledge chunk by primary key.
 *
 * @param {number} id - Chunk primary key
 * @returns {Promise<void>}
 */
async function deleteKnowledgeChunk(id) {
  if (!IS_PG) return;
  await pool.query(`DELETE FROM client_knowledge_chunks WHERE id=$1`, [id]);
}

/**
 * Delete all chunks belonging to a specific document title for a client.
 *
 * @param {string} clientId - Multi-tenant client ID
 * @param {string} title    - Document title
 * @returns {Promise<void>}
 */
async function deleteKnowledgeByTitle(clientId, title) {
  if (!IS_PG) return;
  await pool.query(
    `DELETE FROM client_knowledge_chunks WHERE client_id=$1 AND title=$2`,
    [clientId, title]
  );
}

module.exports = {
  insertKnowledgeChunks,
  vectorSearchKnowledge,
  getKnowledgeSections,
  getKnowledgeChunksByTitle,
  updateKnowledgeChunk,
  deleteKnowledgeChunk,
  deleteKnowledgeByTitle,
};
