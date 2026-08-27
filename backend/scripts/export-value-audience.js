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
 *
 * pj ran on wwjs before this CRM and those customers paid just as much, so
 * point --wwjs at that database and the two are merged on the phone number.
 * Someone who bought in both is one person with the sum of what they spent.
 * The old database is only ever read.
 *
 *   node scripts/export-value-audience.js --wwjs "postgresql://..."
 *   WWJS_DATABASE_URL=postgresql://... node scripts/export-value-audience.js
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

const OUT  = arg('--out', path.join(process.cwd(), 'value-audience.csv'));
const WWJS = arg('--wwjs', process.env.WWJS_DATABASE_URL || '');
const MIN = parseFloat(arg('--min-value', '0')) || 0;

// What a customer is worth when no price was ever recorded against their order.
//
// 258 of 437 have no price - the price field only started being filled on
// 27 Aug 2026, and 280 of those orders predate the 25 Aug reprice. They are
// real sales, so leaving them at 0 understates them; but they outnumber the
// priced ones, so whatever goes here is what the audience is mostly weighted
// by. For reference the known orders run 990 x71, 2990 x43, 1500 x34,
// 3490 x34, mean 2057, median 1500.
const DEFAULT_VALUE = parseFloat(arg('--default-value', '2990')) || 0;


/**
 * Paying customers from the old wwjs system.
 *
 * wwjs stores a package name rather than this CRM's custom_fields, and its
 * prices are not all recorded either, so value is taken where it exists and
 * left at zero where it does not - the same honesty the main query applies.
 *
 * Read-only, on its own connection, and any failure returns nothing rather than
 * taking the export down: a partial audience beats no audience.
 *
 * @param {string} url
 * @returns {Promise<Map<string, {value:number, orders:number}>>}
 */
async function readWwjs(url) {
  const out = new Map();
  if (!url) return out;

  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: url,
    ssl: /railway|rlwy\.net/.test(url) ? { rejectUnauthorized: false } : undefined,
    max: 2,
  });

  try {
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='orders'`);
    const names = new Set(cols.rows.map(r => r.column_name));
    if (!names.has('phone_number')) {
      console.warn('  wwjs: no orders.phone_number, skipping');
      return out;
    }

    // Whatever that schema happens to call the money. wwjs predates the value
    // rule in salesCredit, so it is read leniently rather than assumed.
    const valueExpr = names.has('custom_fields')
      ? `COALESCE(NULLIF(regexp_replace(COALESCE(custom_fields->>'price',''), '[^0-9.]', '', 'g'), '')::numeric, 0)`
      : '0';

    // Scope to this client, always. The old database is multi-tenant - six
    // clients share it, and pj is the smallest of them. Reading it unscoped
    // pulled in 54 of another client's paying customers, who would have gone
    // into pj's lookalike: the wrong population to model, and one client's
    // customer list used for another client's advertising. If the table has no
    // client_id at all it is single-tenant and the whole thing is pj's.
    const scoped = names.has('client_id');
    if (!scoped) console.warn('  wwjs: no client_id column — treating the whole table as this client');

    const { rows } = await pool.query(
      `SELECT phone_number, SUM(${valueExpr})::numeric AS value, COUNT(*)::int AS orders
         FROM orders
        WHERE status IN ('payment_received','paid','delivered','done','complete')
          AND phone_number IS NOT NULL
          ${scoped ? 'AND client_id = $1' : ''}
        GROUP BY phone_number`,
      scoped ? [CLIENT] : []);

    for (const r of rows) {
      const digits = String(r.phone_number).replace(/\D/g, '');
      if (digits) out.set(digits, { value: Number(r.value) || 0, orders: r.orders });
    }
    console.log(`  wwjs: ${out.size} paying customers for ${CLIENT}`);
  } catch (e) {
    console.warn('  wwjs: could not read it —', e.message);
  } finally {
    await pool.end().catch(() => {});
  }
  return out;
}

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

  // Merge on the phone number, the one thing both systems agree about. A
  // person who bought in both is one person with the sum of what they spent.
  const merged = new Map();
  for (const r of rows) {
    const digits = String(r.phone_number).replace(/\D/g, '');
    if (!digits) continue;
    merged.set(digits, { value: Number(r.value) || 0, orders: r.orders, crm: true });
  }

  const old = await readWwjs(WWJS);
  let overlap = 0;
  for (const [digits, o] of old) {
    const cur = merged.get(digits);
    if (cur) {
      cur.value += o.value;
      cur.orders += o.orders;
      overlap++;
    } else {
      merged.set(digits, { value: o.value, orders: o.orders, crm: false });
    }
  }

  // Stand in for the sales whose price was never recorded, so they are not
  // treated as worthless next to the ones that were.
  let estimated = 0;
  for (const v of merged.values()) {
    if (!(v.value > 0) && DEFAULT_VALUE > 0) {
      v.value = DEFAULT_VALUE * Math.max(1, v.orders);
      v.estimated = true;
      estimated++;
    }
  }

  const people = [...merged.entries()]
    .map(([phone, v]) => ({ phone, ...v }))
    .filter(p => p.value >= MIN)
    .sort((a, b) => b.value - a.value);

  if (!people.length) { console.log('  no paying customers matched'); process.exit(0); }

  // Meta's schema is phone and value, and nothing else. It states that a value
  // column "must contain a numeric value only, without any currency
  // characters" - so the currency is not a column, it is chosen in the upload
  // dialog, and the number is written bare rather than quoted.
  const lines = ['phone,value'];
  for (const p of people) {
    // E.164, which is the form Meta matches on. Sri Lankan numbers are stored
    // with the country code already, so this is a prefix rather than a rewrite.
    lines.push(`+${p.phone},${Number(p.value) || 0}`);
  }

  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');

  const withValue = people.filter(p => p.value > 0).length;
  const total = people.reduce((t, p) => t + p.value, 0);
  const repeat = people.filter(p => p.orders > 1).length;

  console.log(`  ${people.length} paying customers -> ${OUT}`);
  const real = people.filter(p => !p.estimated).length;
  console.log(`     ${real} priced from their orders, ${estimated} estimated at Rs ${DEFAULT_VALUE} each`);
  if (estimated > real) {
    console.log(`     note: more are estimated than known, so the weighting mostly reflects`);
    console.log(`           that estimate. --default-value 1500 is the median of the known ones.`);
  }
  console.log(`     ${repeat} have bought more than once`);
  console.log(`     total Rs ${total.toLocaleString()}`);
  if (WWJS) {
    console.log(`     ${old.size} came from wwjs, ${overlap} of them already in the CRM`);
  }
  console.log('');
  console.log('  Ads Manager -> Audiences -> Create -> Customer list.');
  console.log('  Say yes when it asks whether the list includes a value column,');
  console.log('  and set the currency to LKR in that dialog - it is not in the file.');
  console.log('  then build a 1% value-based lookalike from it.');
  console.log('  Delete the file afterwards - it is a list of customer phone numbers.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
