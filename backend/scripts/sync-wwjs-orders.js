/**
 * Bring every order across from the old wwjs system, not just the paid ones.
 *
 * wwjs already had a sync, in backend/src/services/pjSync.js, and it carried one
 * line that shaped everything downstream:
 *
 *     const SOURCE_STATUS = 'payment_received';
 *
 * Only settled orders ever came across. That is why the CRM holds 203 [SYNC]
 * orders and every one of them is paid, and why July reads as a 100% conversion
 * rate — the months that were imported have no unpaid orders in them at all,
 * because unpaid orders were never imported. Any funnel measured across that
 * period is measuring the import, not the business.
 *
 * This carries all of them: 333 pending and 5 cancelled as well as the 203
 * already here. The conversion figures will get worse, and they will be true.
 *
 * Two changes beyond removing that filter.
 *
 * The original upserts customers with ON CONFLICT (phone_number) and sets
 * client_id from the source. customers is keyed on the phone alone, with no
 * client in the key, so that reassigns any customer who already belongs to
 * another tenant. Nothing collides today - all 532 phones are pj's or new - but
 * it is one shared phone number away from moving somebody else's customer, so
 * this refuses rather than reassigns.
 *
 * And it never overwrites a status. An order imported months ago and since
 * marked paid here keeps what this system knows; the old database is not the
 * authority on what has happened since.
 *
 * Dry run by default.
 *
 *   node scripts/sync-wwjs-orders.js
 *   node scripts/sync-wwjs-orders.js --apply
 *   node scripts/sync-wwjs-orders.js --apply --messages   # chat history too
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const { Pool } = require('pg');
const db = require('../src/db');

const CLIENT = process.env.SYNC_CLIENT || 'pj';
const APPLY = process.argv.includes('--apply');
const WITH_MESSAGES = process.argv.includes('--messages');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
}

/** The old system's database. Read only — nothing is ever written back. */
function sourceUrl() {
  const direct = arg('--from', process.env.WWJS_DATABASE_URL);
  if (direct) return direct;
  const envFile = arg('--env', 'C:/Users/ADMIN/Desktop/wwjs-service/backend/.env');
  if (!fs.existsSync(envFile)) return '';
  const txt = fs.readFileSync(envFile, 'utf8');
  const m = txt.match(/^DATABASE_URL=(.*)$/m);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

(async () => {
  if (!db.IS_PG) { console.error('This needs Postgres.'); process.exit(1); }

  const url = sourceUrl();
  if (!url) { console.error('No source database. Pass --from <url> or --env <path to .env>.'); process.exit(1); }

  const src = new Pool({
    connectionString: url,
    ssl: /railway|rlwy\.net/.test(url) ? { rejectUnauthorized: false } : undefined,
    max: 3,
  });

  try {
    // ── every order, whatever its status ────────────────────────────────────
    const { rows: orders } = await src.query(
      `SELECT o.order_id, o.phone_number, o.status, o.custom_fields, o.created_at,
              o.client_id, o.notes, o.ai_summary, o.horoscope_data,
              c.name AS customer_name
         FROM orders o
         LEFT JOIN customers c
           ON c.phone_number = o.phone_number AND c.client_id = o.client_id
        WHERE o.client_id = $1
        ORDER BY o.created_at`,
      [CLIENT]
    );
    if (!orders.length) { console.log(`  no orders for ${CLIENT} in the source`); process.exit(0); }

    const byStatus = orders.reduce((m, o) => { m[o.status] = (m[o.status] || 0) + 1; return m; }, {});
    console.log(`  ${orders.length} order(s) in the source:`);
    Object.entries(byStatus).sort((a, b) => b[1] - a[1])
      .forEach(([s, n]) => console.log(`    ${String(s).padEnd(20)} ${n}`));

    const tagged = orders.map(o => ({
      ...o,
      targetId: o.order_id.endsWith('[SYNC]') ? o.order_id : `${o.order_id}[SYNC]`,
    }));

    // What is already here, so the dry run says what will change rather than
    // what will be sent.
    const { rows: existing } = await db.pgQuery(
      'SELECT order_id, status FROM orders WHERE client_id=$1 AND order_id = ANY($2)',
      [CLIENT, tagged.map(o => o.targetId)]
    );
    const here = new Map(existing.map(r => [r.order_id, r.status]));
    const fresh = tagged.filter(o => !here.has(o.targetId));
    const changed = tagged.filter(o => here.has(o.targetId) && here.get(o.targetId) !== o.status);

    console.log(`\n    ${fresh.length} new, ${tagged.length - fresh.length} already here`);
    if (changed.length) {
      console.log(`    ${changed.length} differ in status — this system's value is kept:`);
      changed.slice(0, 5).forEach(o =>
        console.log(`      ${o.targetId}  here="${here.get(o.targetId)}"  source="${o.status}"`));
    }

    // ── customers: refuse to move anyone who is not already ours ────────────
    const phones = [...new Set(orders.map(o => o.phone_number).filter(Boolean))];
    const { rows: owners } = await db.pgQuery(
      'SELECT phone_number, client_id FROM customers WHERE phone_number = ANY($1)', [phones]);
    const foreign = owners.filter(r => r.client_id && r.client_id !== CLIENT);
    console.log(`\n    ${phones.length} customer(s), ${owners.length} already known here`);
    if (foreign.length) {
      console.log(`    ${foreign.length} belong to another client and will be LEFT ALONE:`);
      foreign.slice(0, 5).forEach(r => console.log(`      ...${r.phone_number.slice(-4)} -> ${r.client_id}`));
    }
    const foreignSet = new Set(foreign.map(r => r.phone_number));

    let messageCount = 0;
    if (WITH_MESSAGES) {
      const { rows: [m] } = await src.query(
        'SELECT COUNT(*)::int n FROM messages WHERE client_id=$1 AND phone_number = ANY($2)',
        [CLIENT, phones]);
      messageCount = m.n;
      console.log(`    ${messageCount} message(s) would be considered (duplicates skipped)`);
    } else {
      console.log('    messages not included — add --messages for the chat history');
    }

    if (!APPLY) {
      console.log('\n  dry run - nothing written. Re-run with --apply.');
      process.exit(0);
    }

    // ── customers ───────────────────────────────────────────────────────────
    let custDone = 0;
    for (const phone of phones) {
      if (foreignSet.has(phone)) continue;
      const row = orders.find(o => o.phone_number === phone);
      await db.pgQuery(
        `INSERT INTO customers (phone_number, name, client_id)
         VALUES ($1,$2,$3)
         ON CONFLICT (phone_number) DO UPDATE
           SET name = COALESCE(customers.name, EXCLUDED.name)`,
        [phone, row?.customer_name ?? null, CLIENT]
      );
      custDone++;
    }
    console.log(`\n  customers: ${custDone} inserted or left as they were`);

    // ── orders ──────────────────────────────────────────────────────────────
    let done = 0;
    for (const o of tagged) {
      await db.pgQuery(
        `INSERT INTO orders
           (order_id, phone_number, status, custom_fields, created_at,
            client_id, notes, ai_summary, horoscope_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (order_id) DO UPDATE SET
           custom_fields  = COALESCE(orders.custom_fields, EXCLUDED.custom_fields),
           notes          = COALESCE(orders.notes, EXCLUDED.notes),
           ai_summary     = COALESCE(orders.ai_summary, EXCLUDED.ai_summary),
           horoscope_data = COALESCE(orders.horoscope_data, EXCLUDED.horoscope_data)`,
        [o.targetId, o.phone_number, o.status, o.custom_fields ?? null, o.created_at,
         CLIENT, o.notes ?? null, o.ai_summary ?? null, o.horoscope_data ?? null]
      );
      done++;
      if (done % 50 === 0) process.stdout.write(`\r  orders: ${done}/${tagged.length}`);
    }
    console.log(`\r  orders: ${done} synced${' '.repeat(20)}`);

    // ── messages ────────────────────────────────────────────────────────────
    if (WITH_MESSAGES) {
      const { rows: msgs } = await src.query(
        `SELECT phone_number, message_text, sender_type, created_at,
                cost_usd, media_type, media_url
           FROM messages WHERE client_id=$1 AND phone_number = ANY($2)
          ORDER BY created_at`,
        [CLIENT, phones]);
      let added = 0;
      for (const m of msgs) {
        if (foreignSet.has(m.phone_number)) continue;
        const r = await db.pgQuery(
          `INSERT INTO messages
             (phone_number, message_text, sender_type, created_at, cost_usd, client_id, media_type, media_url)
           SELECT $1,$2,$3,$4,$5,$6,$7,$8
            WHERE NOT EXISTS (
              SELECT 1 FROM messages
               WHERE client_id=$6 AND phone_number=$1 AND created_at=$4 AND sender_type=$3)`,
          [m.phone_number, m.message_text, m.sender_type, m.created_at,
           m.cost_usd ?? null, CLIENT, m.media_type ?? null, m.media_url ?? null]
        );
        added += r.rowCount || 0;
        if (added && added % 500 === 0) process.stdout.write(`\r  messages: ${added} added`);
      }
      console.log(`\r  messages: ${added} added, ${msgs.length - added} were already here${' '.repeat(10)}`);
    }

    console.log('\n  done');
  } finally {
    await src.end().catch(() => {});
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
