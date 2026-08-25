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
async function insertMessage(phoneNumber, text, senderType, costUsd = null, clientId = null, mediaType = null, mediaUrl = null, wamid = null, interactive = null, opts = {}) {
  const sentBy = opts.sentBy ?? null;
  if (IS_PG) {
    await pool.query(
      'INSERT INTO messages (phone_number, message_text, sender_type, cost_usd, client_id, media_type, media_url, wamid, interactive, sent_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [phoneNumber, text, senderType, costUsd, clientId, mediaType, mediaUrl, wamid, interactive ? JSON.stringify(interactive) : null, sentBy]
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


/**
 * How far a message has got. Higher wins, so an out-of-order callback can never
 * walk a message backwards from read to delivered.
 */
const STATUS_RANK = { sent: 1, delivered: 2, read: 3, failed: 4 };

/**
 * Record a delivery receipt from WhatsApp against the message it belongs to.
 *
 * @param {string} wamid   - WhatsApp message id from the status callback
 * @param {string} status  - sent | delivered | read | failed
 * @param {{code?: number, message?: string}} [err] - present on failure
 * @returns {Promise<boolean>} whether a message row matched
 */
async function updateMessageStatus(wamid, status, err = {}) {
  if (!wamid || !STATUS_RANK[status]) return false;
  const rank = STATUS_RANK[status];
  // A failure is always worth recording; otherwise only move forward.
  const guard = status === 'failed'
    ? ''
    : ` AND COALESCE(CASE delivery_status
          WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE 0 END, 0) < ${rank}`;

  if (IS_PG) {
    const res = await pool.query(
      `UPDATE messages SET
         delivery_status = $2,
         delivered_at = CASE WHEN $2 IN ('delivered','read') AND delivered_at IS NULL THEN NOW() ELSE delivered_at END,
         read_at      = CASE WHEN $2 = 'read' AND read_at IS NULL THEN NOW() ELSE read_at END,
         error_code    = COALESCE($3, error_code),
         error_message = COALESCE($4, error_message)
       WHERE wamid = $1${guard}`,
      [wamid, status, err.code ?? null, err.message ?? null]
    );
    return res.rowCount > 0;
  }
  const row = db.prepare('SELECT delivery_status FROM messages WHERE wamid = ?').get(wamid);
  if (!row) return false;
  if (status !== 'failed' && (STATUS_RANK[row.delivery_status] || 0) >= rank) return false;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE messages SET delivery_status = ?,
       delivered_at = COALESCE(delivered_at, ?), read_at = COALESCE(read_at, ?),
       error_code = COALESCE(?, error_code), error_message = COALESCE(?, error_message)
     WHERE wamid = ?`
  ).run(status, (status === 'delivered' || status === 'read') ? now : null,
        status === 'read' ? now : null, err.code ?? null, err.message ?? null, wamid);
  return true;
}

/**
 * Attach a wamid to the most recent bot message that has none.
 *
 * The reply is written to the database before it is sent, so the id only exists
 * afterwards. A reply split across several WhatsApp messages gets the id of the
 * last part, because a read receipt on that part means the whole reply was seen.
 *
 * @param {string} phoneNumber
 * @param {string} clientId
 * @param {string} wamid
 * @returns {Promise<void>}
 */
async function attachWamidToLatestBotMessage(phoneNumber, clientId, wamid) {
  if (!wamid) return;
  if (IS_PG) {
    await pool.query(
      `UPDATE messages SET wamid = $3, delivery_status = 'sent'
        WHERE id = (SELECT id FROM messages
                     WHERE phone_number = $1 AND client_id = $2
                       AND sender_type = 'bot' AND wamid IS NULL
                     ORDER BY id DESC LIMIT 1)`,
      [phoneNumber, clientId, wamid]
    );
    return;
  }
  const row = db.prepare(
    `SELECT id FROM messages WHERE phone_number = ? AND client_id = ?
       AND sender_type = 'bot' AND wamid IS NULL ORDER BY id DESC LIMIT 1`
  ).get(phoneNumber, clientId);
  if (row) db.prepare(`UPDATE messages SET wamid = ?, delivery_status = 'sent' WHERE id = ?`).run(wamid, row.id);
}

/**
 * Store what was read out of an attachment, against the message that carried it.
 *
 * Keyed on the WhatsApp message id, which is unique and already recorded when
 * the attachment arrives, so a slow analysis cannot attach itself to a later
 * message from the same customer.
 *
 * @param {string} wamid
 * @param {Object} data - the vision result, or { text } for a plain extraction
 * @returns {Promise<boolean>} whether a message matched
 */
async function setMessageExtraction(wamid, data) {
  if (!wamid || !data) return false;
  const payload = JSON.stringify(data);
  if (IS_PG) {
    const res = await pool.query('UPDATE messages SET extracted=$2 WHERE wamid=$1', [wamid, payload]);
    return res.rowCount > 0;
  }
  const r = db.prepare('UPDATE messages SET extracted=? WHERE wamid=?').run(payload, wamid);
  return r.changes > 0;
}

module.exports = { insertMessage, getMessagesByPhone, deleteMessages, deleteMessage, updateMessageStatus, attachWamidToLatestBotMessage, setMessageExtraction };
