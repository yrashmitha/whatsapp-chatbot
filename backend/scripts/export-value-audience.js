/**
 * Export paying customers, with what each was worth, for a value-based audience.
 *
 * The lookalike currently in use is modelled on people who sent a message. That
 * is the population producing the cheap, low-intent leads - Meta was asked to
 * find people likely to start a conversation and did exactly that. A lookalike
 * modelled on people who paid, weighted by how much, describes a different
 * population, and it needs no attribution, no dataset and no waiting.
 *
 * Only 3 of 437 paying customers arrived through a tracked ad click, so there is
 * no ad-to-sale history for Meta to learn from. This list is the substitute:
 * not "who responded to an ad" but "who is worth finding".
 *
 * The value column is what makes it value-based. A customer who paid 3,490 and
 * one who paid 990 should not carry the same weight, and orders with no price on
 * record are summed as far as they can be rather than invented.
 *
 * Phone numbers are exported in plain E.164. Meta hashes them in the browser
 * before upload, which is why their own template asks for them unhashed - do not
 * pre-hash, or nothing will match. Delete the file once it is uploaded.
 *
 *   node scripts/export-value-audience.js
 *   node scripts/export-value-audience.js --out audience.csv --min-value 1
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const db = require('../src/db');
const { PAID_STATUSES, VALUE_SQL } = require('../src/services/salesCredit');

const CLIENT = process.env.AUDIENCE_CLIENT || 'pj';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const OUT = arg('--out', path.join(process.cwd(), 'value-audience.csv'));
const MIN = parseFloat(arg('--min-value', '0')) || 0;

(async () => {
  if (!db.IS_PG) { console.error('This needs Postgres.'); process.exit(1); }

  // One row per customer, not per order. A repeat buyer is a stronger signal
  // than two separate people, and Meta weights on the total.
  const { rows } = await db.pgQuery(
    `SELECT o.phone_number,
            SUM(${VALUE_SQL})::numeric AS value,
            COUNT(*)::int              AS orders,
            MAX(o.created_at)          AS last_order
       FROM orders o
      WHERE o.client_id = $1 AND o.status = ANY($2)
        AND o.phone_number IS NOT NULL
      GROUP BY o.phone_number
      HAVING SUM(${VALUE_SQL}) >= $3
      ORDER BY value DESC`,
    [CLIENT, PAID_STATUSES, MIN]
  );

  if (!rows.length) { console.log('  no paying customers matched'); process.exit(0); }

  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['phone,value,currency'];
  for (const r of rows) {
    // E.164, which is the form Meta matches on. Sri Lankan numbers are stored
    // with the country code already, so this is a prefix rather than a rewrite.
    const digits = String(r.phone_number).replace(/\D/g, '');
    if (!digits) continue;
    lines.push([esc(`+${digits}`), esc(Number(r.value) || 0), esc('LKR')].join(','));
  }

  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');

  const withValue = rows.filter(r => Number(r.value) > 0).length;
  const total = rows.reduce((t, r) => t + (Number(r.value) || 0), 0);
  const repeat = rows.filter(r => r.orders > 1).length;

  console.log(`  ${rows.length} paying customers -> ${OUT}`);
  console.log(`     ${withValue} carry a value, ${rows.length - withValue} are 0 (no price on record)`);
  console.log(`     ${repeat} have bought more than once`);
  console.log(`     total Rs ${total.toLocaleString()}`);
  console.log('');
  console.log('  Ads Manager -> Audiences -> Create -> Customer list.');
  console.log('  Say yes when it asks whether the list includes a value column,');
  console.log('  then build a 1% value-based lookalike from it.');
  console.log('  Delete the file afterwards - it is a list of customer phone numbers.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
