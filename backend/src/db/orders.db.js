/**
 * @module db/orders.db
 * @description Database access layer for the orders table.
 * Abstracts over PostgreSQL (production) and SQLite (local dev).
 */

'use strict';

const { pool, db, IS_PG } = require('./connection');

/**
 * Insert a new order record into the database.
 *
 * @param {string}      orderId      - Unique order ID (e.g. "PJ2026-0001")
 * @param {string}      phoneNumber  - Customer E.164 phone number
 * @param {string|null} clientId     - Multi-tenant client ID
 * @param {Object|null} customFields - Collected order fields (birth_date, birth_time, etc.)
 * @returns {Promise<void>}
 */
async function insertOrder(orderId, phoneNumber, clientId, customFields) {
  if (IS_PG) {
    await pool.query(
      'INSERT INTO orders (order_id, phone_number, client_id, custom_fields) VALUES ($1,$2,$3,$4)',
      [orderId, phoneNumber, clientId || null, customFields || null]
    );
  } else {
    db.prepare(
      'INSERT INTO orders (order_id, phone_number, client_id, custom_fields) VALUES (?,?,?,?)'
    ).run(orderId, phoneNumber, clientId || null, customFields ? JSON.stringify(customFields) : null);
  }
}

/**
 * Return all orders for a phone number ordered newest-first.
 *
 * @param {string} phoneNumber - E.164 customer phone number
 * @returns {Promise<Array>} Array of order row objects
 */
async function getOrdersByPhone(phoneNumber) {
  if (IS_PG) {
    const res = await pool.query(
      'SELECT * FROM orders WHERE phone_number = $1 ORDER BY created_at DESC',
      [phoneNumber]
    );
    return res.rows;
  } else {
    return db.prepare('SELECT * FROM orders WHERE phone_number = ? ORDER BY created_at DESC').all(phoneNumber);
  }
}

/**
 * Return the most recent order for a phone number, or null if none exist.
 *
 * @param {string} phoneNumber - E.164 customer phone number
 * @returns {Promise<Object|null>}
 */
async function getLatestOrder(phoneNumber) {
  if (IS_PG) {
    const res = await pool.query(
      'SELECT * FROM orders WHERE phone_number = $1 ORDER BY created_at DESC LIMIT 1',
      [phoneNumber]
    );
    return res.rows[0] || null;
  } else {
    return db.prepare('SELECT * FROM orders WHERE phone_number = ? ORDER BY created_at DESC LIMIT 1').get(phoneNumber) || null;
  }
}

/**
 * Update the status of the most recent order for a phone number.
 *
 * @param {string} phoneNumber - E.164 customer phone number
 * @param {string} status      - New status value
 * @returns {Promise<void>}
 */
async function updateLatestOrderStatus(phoneNumber, status) {
  if (IS_PG) {
    await pool.query(
      `UPDATE orders SET status = $1
       WHERE id = (SELECT id FROM orders WHERE phone_number = $2 ORDER BY created_at DESC LIMIT 1)`,
      [status, phoneNumber]
    );
  } else {
    db.prepare(
      `UPDATE orders SET status = ?
       WHERE id = (SELECT id FROM orders WHERE phone_number = ? ORDER BY created_at DESC LIMIT 1)`
    ).run(status, phoneNumber);
  }
}

/**
 * Update the status of an order by its order_id.
 *
 * @param {string} orderId - Unique order ID
 * @param {string} status  - New status value
 * @returns {Promise<void>}
 */
async function updateOrderStatusById(orderId, status) {
  if (IS_PG) {
    await pool.query('UPDATE orders SET status = $1 WHERE order_id = $2', [status, orderId]);
  } else {
    db.prepare('UPDATE orders SET status = ? WHERE order_id = ?').run(status, orderId);
  }
}

/**
 * Save an AI-generated summary for an order.
 *
 * @param {string} orderId - Unique order ID
 * @param {string} summary - AI summary text
 * @returns {Promise<void>}
 */
async function updateOrderAISummary(orderId, summary) {
  if (IS_PG) {
    await pool.query('UPDATE orders SET ai_summary=$1 WHERE order_id=$2', [summary, orderId]);
  } else {
    db.prepare('UPDATE orders SET ai_summary=? WHERE order_id=?').run(summary, orderId);
  }
}

/**
 * Replace the custom_fields JSON on an order.
 *
 * @param {string} orderId      - Unique order ID
 * @param {Object} customFields - Full custom_fields object to save
 * @returns {Promise<void>}
 */
async function updateOrderCustomFields(orderId, customFields) {
  if (IS_PG) {
    await pool.query('UPDATE orders SET custom_fields=$1 WHERE order_id=$2',
      [customFields, orderId]);
  } else {
    db.prepare('UPDATE orders SET custom_fields=? WHERE order_id=?')
      .run(JSON.stringify(customFields), orderId);
  }
}

/**
 * Count how many orders match an order_id LIKE pattern (used for ID generation).
 *
 * @param {string} pattern - SQL LIKE pattern e.g. "PJ2026-%"
 * @returns {Promise<number>}
 */
async function countOrdersByYear(pattern) {
  if (IS_PG) {
    const res = await pool.query(
      "SELECT COUNT(*) AS cnt FROM orders WHERE order_id LIKE $1",
      [pattern]
    );
    return parseInt(res.rows[0].cnt, 10);
  } else {
    const row = db.prepare("SELECT COUNT(*) as cnt FROM orders WHERE order_id LIKE ?").get(pattern);
    return row.cnt || 0;
  }
}

module.exports = {
  insertOrder,
  getOrdersByPhone,
  getLatestOrder,
  updateLatestOrderStatus,
  updateOrderStatusById,
  updateOrderAISummary,
  updateOrderCustomFields,
  countOrdersByYear,
};
