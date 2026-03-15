/**
 * @module db/media.db
 * @description Database access layer for the client_media table (media library).
 * Abstracts over PostgreSQL (production) and SQLite (local dev).
 */

'use strict';

const { pool, IS_PG } = require('./connection');

/**
 * Return all media items for a client, ordered by sort_order then created_at.
 *
 * @param {string} clientId - Multi-tenant client ID
 * @returns {Promise<Array>} Array of media row objects
 */
async function getClientMedia(clientId) {
  if (!IS_PG) return [];
  const r = await pool.query(
    `SELECT id, title, description, image_url, sort_order FROM client_media
     WHERE client_id=$1 ORDER BY sort_order, created_at`,
    [clientId]
  );
  return r.rows;
}

/**
 * Insert a new media item and return its generated id.
 * Returns null on SQLite.
 *
 * @param {string} clientId   - Multi-tenant client ID
 * @param {string} title       - Short display title
 * @param {string} description - AI-facing description of the image
 * @param {string} imageUrl    - Publicly accessible image URL
 * @param {number} [sortOrder] - Display order (lower = first)
 * @returns {Promise<number|null>} New row id, or null
 */
async function insertMedia(clientId, title, description, imageUrl, sortOrder = 0) {
  if (!IS_PG) return null;
  const r = await pool.query(
    `INSERT INTO client_media (client_id, title, description, image_url, sort_order)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [clientId, title, description, imageUrl, sortOrder]
  );
  return r.rows[0].id;
}

/**
 * Delete a media item by id (scoped to client for safety).
 *
 * @param {number} id       - Media primary key
 * @param {string} clientId - Multi-tenant client ID
 * @returns {Promise<void>}
 */
async function deleteMedia(id, clientId) {
  if (!IS_PG) return;
  await pool.query(`DELETE FROM client_media WHERE id=$1 AND client_id=$2`, [id, clientId]);
}

/**
 * Update all editable fields of a media item.
 *
 * @param {number} id          - Media primary key
 * @param {string} clientId    - Multi-tenant client ID
 * @param {string} title       - New title
 * @param {string} description - New description
 * @param {string} imageUrl    - New image URL
 * @param {number} sortOrder   - New sort order
 * @returns {Promise<void>}
 */
async function updateMedia(id, clientId, title, description, imageUrl, sortOrder) {
  if (!IS_PG) return;
  await pool.query(
    `UPDATE client_media SET title=$3, description=$4, image_url=$5, sort_order=$6
     WHERE id=$1 AND client_id=$2`,
    [id, clientId, title, description, imageUrl, sortOrder]
  );
}

module.exports = { getClientMedia, insertMedia, deleteMedia, updateMedia };
