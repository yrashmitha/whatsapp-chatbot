/**
 * @module db/messages.db
 * @description Database access layer for the messages table.
 * Abstracts over PostgreSQL (production) and SQLite (local dev).
 */

'use strict';

const { pool, db, IS_PG } = require('./connection');

/**
 * Insert a message record into the database.
 *
 * @param {string}      phoneNumber - E.164 customer phone number
 * @param {string}      text        - Message body
 * @param {string}      senderType  - 'user' or 'bot'
 * @param {number|null} [costUsd]   - Gemini API cost in USD (bot messages only)
 * @param {string|null} [clientId]  - Multi-tenant client ID
 * @param {string|null} [mediaType] - 'image', 'pdf', 'audio', etc.
 * @param {string|null} [mediaUrl]  - Stored media URL
 * @param {string|null} [wamid]     - WhatsApp message ID (for sent messages)
 * @returns {Promise<void>}
 */
async function insertMessage(phoneNumber, text, senderType, costUsd = null, clientId = null, mediaType = null, mediaUrl = null, wamid = null) {
  if (IS_PG) {
    await pool.query(
      'INSERT INTO messages (phone_number, message_text, sender_type, cost_usd, client_id, media_type, media_url, wamid) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [phoneNumber, text, senderType, costUsd, clientId, mediaType, mediaUrl, wamid]
    );
    if (senderType === 'user') {
      await pool.query(
        'UPDATE customers SET last_customer_message_at = NOW() WHERE phone_number = $1 AND client_id = $2',
        [phoneNumber, clientId]
      );
    }
  } else {
    db.prepare('INSERT INTO messages (phone_number, message_text, sender_type, cost_usd, client_id, media_type, media_url, wamid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(phoneNumber, text, senderType, costUsd, clientId, mediaType, mediaUrl, wamid);
    if (senderType === 'user') {
      db.prepare('UPDATE customers SET last_customer_message_at = datetime(\'now\') WHERE phone_number = ? AND client_id = ?').run(phoneNumber, clientId);
    }
  }
}

/**
 * Retrieve all messages for a phone number ordered oldest-first.
 *
 * @param {string} phoneNumber - E.164 customer phone number
 * @returns {Promise<Array>} Array of message row objects
 */
async function getMessagesByPhone(phoneNumber, clientId) {
  if (IS_PG) {
    const res = clientId
      ? await pool.query(
          'SELECT * FROM messages WHERE phone_number = $1 AND client_id = $2 ORDER BY created_at ASC',
          [phoneNumber, clientId]
        )
      : await pool.query(
          'SELECT * FROM messages WHERE phone_number = $1 ORDER BY created_at ASC',
          [phoneNumber]
        );
    return res.rows;
  } else {
    return clientId
      ? db.prepare('SELECT * FROM messages WHERE phone_number = ? AND client_id = ? ORDER BY created_at ASC').all(phoneNumber, clientId)
      : db.prepare('SELECT * FROM messages WHERE phone_number = ? ORDER BY created_at ASC').all(phoneNumber);
  }
}

/**
 * Delete all messages for a phone number.
 *
 * @param {string} phoneNumber - E.164 customer phone number
 * @returns {Promise<void>}
 */
async function deleteMessages(phoneNumber, clientId) {
  if (IS_PG) {
    if (clientId) {
      await pool.query('DELETE FROM messages WHERE phone_number = $1 AND client_id = $2', [phoneNumber, clientId]);
    } else {
      await pool.query('DELETE FROM messages WHERE phone_number = $1', [phoneNumber]);
    }
  } else {
    if (clientId) {
      db.prepare('DELETE FROM messages WHERE phone_number = ? AND client_id = ?').run(phoneNumber, clientId);
    } else {
      db.prepare('DELETE FROM messages WHERE phone_number = ?').run(phoneNumber);
    }
  }
}

/**
 * Soft-delete a single message by ID (sets is_deleted = true).
 * Returns the deleted row's wamid and sender_type, or null if not found.
 *
 * @param {number} id       - Message primary key
 * @param {string} clientId - Multi-tenant client ID (ownership check)
 * @returns {Promise<{wamid: string|null, sender_type: string}|null>}
 */
async function deleteMessage(id, clientId) {
  if (IS_PG) {
    const res = await pool.query(
      'UPDATE messages SET is_deleted = TRUE WHERE id = $1 AND client_id = $2 RETURNING wamid, sender_type',
      [id, clientId]
    );
    return res.rows[0] || null;
  } else {
    const row = db.prepare('SELECT wamid, sender_type FROM messages WHERE id = ? AND client_id = ?').get(id, clientId);
    if (!row) return null;
    db.prepare('UPDATE messages SET is_deleted = 1 WHERE id = ?').run(id);
    return row;
  }
}

module.exports = { insertMessage, getMessagesByPhone, deleteMessages, deleteMessage };
