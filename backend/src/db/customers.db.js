/**
 * @module db/customers.db
 * @description Database access layer for the customers table.
 * Abstracts over PostgreSQL (production) and SQLite (local dev).
 */

'use strict';

const { pool, db, IS_PG } = require('./connection');

/**
 * Insert or update a customer record (upsert).
 * Only updates name and client_id when the new value is non-null.
 *
 * @param {string}      phoneNumber - E.164 customer phone number (primary key)
 * @param {string|null} name        - Customer display name
 * @param {string|null} clientId    - Multi-tenant client ID
 * @returns {Promise<void>}
 */
async function upsertCustomer(phoneNumber, name, clientId) {
  if (IS_PG) {
    await pool.query(`
      INSERT INTO customers (phone_number, name, client_id, updated_at) VALUES ($1, $2, $3, NOW())
      ON CONFLICT(phone_number) DO UPDATE SET
        name       = COALESCE(EXCLUDED.name, customers.name),
        client_id  = COALESCE(EXCLUDED.client_id, customers.client_id),
        updated_at = NOW()
    `, [phoneNumber, name, clientId || null]);
  } else {
    db.prepare(`
      INSERT INTO customers (phone_number, name, client_id, updated_at) VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(phone_number) DO UPDATE SET
        name       = COALESCE(excluded.name, name),
        client_id  = COALESCE(excluded.client_id, client_id),
        updated_at = datetime('now')
    `).run(phoneNumber, name, clientId || null);
  }
}

/**
 * Return all customers with aggregated message/order counts.
 *
 * @returns {Promise<Array>} Array of customer summary rows
 */
async function getAllCustomers(clientId) {
  if (IS_PG) {
    const res = clientId
      ? await pool.query(`
          SELECT
            c.phone_number, c.name,
            MAX(m.created_at) AS last_seen,
            COUNT(DISTINCT m.id)::int AS msg_count,
            COUNT(DISTINCT o.id)::int AS order_count
          FROM customers c
          LEFT JOIN messages m ON m.phone_number = c.phone_number AND m.client_id = $1
          LEFT JOIN orders   o ON o.phone_number = c.phone_number AND o.client_id = $1
          WHERE c.client_id = $1
          GROUP BY c.phone_number, c.name
          ORDER BY last_seen DESC NULLS LAST
        `, [clientId])
      : await pool.query(`
          SELECT
            c.phone_number, c.name,
            MAX(m.created_at) AS last_seen,
            COUNT(DISTINCT m.id)::int AS msg_count,
            COUNT(DISTINCT o.id)::int AS order_count
          FROM customers c
          LEFT JOIN messages m ON m.phone_number = c.phone_number
          LEFT JOIN orders   o ON o.phone_number = c.phone_number
          GROUP BY c.phone_number, c.name
          ORDER BY last_seen DESC NULLS LAST
        `);
    return res.rows;
  } else {
    return db.prepare(`
      SELECT
        c.phone_number, c.name,
        MAX(m.created_at) AS last_seen,
        COUNT(DISTINCT m.id) AS msg_count,
        COUNT(DISTINCT o.id) AS order_count
      FROM customers c
      LEFT JOIN messages m ON m.phone_number = c.phone_number
      LEFT JOIN orders   o ON o.phone_number = c.phone_number
      GROUP BY c.phone_number, c.name
      ORDER BY last_seen DESC
    `).all();
  }
}

/**
 * Delete a customer and all related messages/orders (via CASCADE).
 *
 * @param {string} phoneNumber - E.164 customer phone number
 * @returns {Promise<void>}
 */
async function deleteCustomer(phoneNumber, clientId) {
  if (IS_PG) {
    // Delete messages and orders scoped to this client, then remove customer record only if no data remains
    if (clientId) {
      await pool.query('DELETE FROM messages WHERE phone_number = $1 AND client_id = $2', [phoneNumber, clientId]);
      await pool.query('DELETE FROM orders WHERE phone_number = $1 AND client_id = $2', [phoneNumber, clientId]);
      // Remove customer record only if no messages/orders remain for any client
      await pool.query(`
        DELETE FROM customers WHERE phone_number = $1
        AND NOT EXISTS (SELECT 1 FROM messages WHERE phone_number = $1)
        AND NOT EXISTS (SELECT 1 FROM orders WHERE phone_number = $1)
      `, [phoneNumber]);
    } else {
      await pool.query('DELETE FROM customers WHERE phone_number = $1', [phoneNumber]);
    }
  } else {
    db.prepare('DELETE FROM customers WHERE phone_number = ?').run(phoneNumber);
  }
}

/**
 * Check whether the AI bot is enabled for a specific customer+client pair.
 * Returns true by default when no explicit setting exists.
 *
 * @param {string} phone    - E.164 customer phone number
 * @param {string} clientId - Multi-tenant client ID
 * @returns {Promise<boolean>}
 */
async function getCustomerAiEnabled(phone, clientId) {
  if (!IS_PG) return true; // local dev always AI on
  const r = await pool.query(
    `SELECT ai_enabled FROM customer_settings WHERE phone_number=$1 AND client_id=$2`,
    [phone, clientId]
  );
  return r.rows.length === 0 ? true : !!r.rows[0].ai_enabled;
}

/**
 * Enable or disable the AI bot for a specific customer+client pair.
 *
 * @param {string}  phone    - E.164 customer phone number
 * @param {string}  clientId - Multi-tenant client ID
 * @param {boolean} enabled  - New AI mode value
 * @returns {Promise<void>}
 */
async function setCustomerAiMode(phone, clientId, enabled) {
  if (!IS_PG) return;
  await pool.query(
    `INSERT INTO customer_settings (phone_number, client_id, ai_enabled)
     VALUES ($1, $2, $3)
     ON CONFLICT (phone_number, client_id) DO UPDATE SET ai_enabled=$3`,
    [phone, clientId, enabled]
  );
}

module.exports = { upsertCustomer, getAllCustomers, deleteCustomer, getCustomerAiEnabled, setCustomerAiMode };
