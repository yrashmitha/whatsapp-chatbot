/**
 * Backfill last_customer_message_at for all existing customers.
 *
 * Sets each customer's last_customer_message_at to the MAX created_at
 * of messages where sender_type = 'user', scoped by client_id.
 *
 * Usage:
 *   node backend/scripts/backfill-last-customer-message.js
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { pool, db, IS_PG } = require('../src/db/connection');

async function run() {
  if (IS_PG) {
    console.log('[backfill] Running on PostgreSQL...');
    const res = await pool.query(`
      UPDATE customers c
      SET last_customer_message_at = sub.last_at
      FROM (
        SELECT phone_number, client_id, MAX(created_at) AS last_at
        FROM messages
        WHERE sender_type = 'user'
        GROUP BY phone_number, client_id
      ) sub
      WHERE c.phone_number = sub.phone_number
        AND c.client_id    = sub.client_id
        AND c.last_customer_message_at IS NULL
    `);
    console.log(`[backfill] Updated ${res.rowCount} customers.`);
    await pool.end();
  } else {
    console.log('[backfill] Running on SQLite...');
    const stmt = db.prepare(`
      UPDATE customers
      SET last_customer_message_at = (
        SELECT MAX(created_at)
        FROM messages m
        WHERE m.phone_number = customers.phone_number
          AND m.client_id    = customers.client_id
          AND m.sender_type  = 'user'
      )
      WHERE last_customer_message_at IS NULL
    `);
    const result = stmt.run();
    console.log(`[backfill] Updated ${result.changes} customers.`);
  }

  console.log('[backfill] Done.');
  process.exit(0);
}

run().catch(e => {
  console.error('[backfill] Error:', e.message);
  process.exit(1);
});
