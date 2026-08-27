/**
 * Give the bot somewhere to record what the customer agreed to pay.
 *
 * The order fields ask for a name and birth details and never ask what the
 * customer is buying, so nothing the bot records says what the sale was worth.
 * Unless a payment slip turned up later, the order is worth nothing - which is
 * true of most of them.
 *
 * price becomes a field like any other. The model fills it the way it fills the
 * name: by reading what is in front of it. In this case that is the block it
 * has just sent, which carries the figure in its own words, so this is reading
 * rather than recall.
 *
 * Optional on purpose. A required field is one the bot will chase the customer
 * for, and the customer must never be asked what to pay.
 *
 * Dry run by default. Pass --apply to write.
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('../src/db');

const CLIENT = process.env.PRICE_FIELD_CLIENT || 'pj';
const APPLY  = process.argv.includes('--apply');

const FIELD = {
  key: 'price',
  label: 'එකඟ වූ ගාස්තුව',
  required: false,
  description:
    'The price this customer agreed to pay, in rupees, digits only (for example 1500). '
    + 'Take it from the figure in the message you sent them - the discounted "today only" '
    + 'price, not the usual price it is compared against. Never ask the customer what to '
    + 'pay and never invent a figure: if no price was quoted in this conversation, leave '
    + 'this empty.',
};

// The old wording pointed at a package that was withdrawn on the 25th.
const NEEDS_DESCRIPTION =
  'ask them to tell everything they have in their mind, no matter how much problems they '
  + 'have, we will answer each and every one. Only for the full life report. Do not ask '
  + 'when the customer chose the single-area or porondam service.';

(async () => {
  if (!db.IS_PG) {
    console.error('This needs Postgres. Set DATABASE_URL.');
    process.exit(1);
  }

  const { rows } = await db.pgQuery(
    'SELECT order_fields FROM client_configs WHERE client_id=$1', [CLIENT]);
  if (!rows.length) {
    console.error(`No client_configs row for ${CLIENT}`);
    process.exit(1);
  }

  const fields = Array.isArray(rows[0].order_fields) ? rows[0].order_fields : [];

  const existing = fields.find(f => f && f.key === 'price');
  if (existing) {
    console.log('  price field already present:');
    console.log(`    ${existing.description}`);
  } else {
    fields.push(FIELD);
    console.log('  + price');
    console.log(`    ${FIELD.description}`);
  }

  const needs = fields.find(f => f && f.key === 'needs');
  if (needs && needs.description !== NEEDS_DESCRIPTION) {
    console.log('');
    console.log('  ~ needs');
    console.log(`    was: ${needs.description}`);
    console.log(`    now: ${NEEDS_DESCRIPTION}`);
    needs.description = NEEDS_DESCRIPTION;
  }

  if (APPLY) {
    await db.pgQuery('UPDATE client_configs SET order_fields=$1 WHERE client_id=$2',
      [JSON.stringify(fields), CLIENT]);
    console.log('');
    console.log(`  applied - ${fields.length} order fields for ${CLIENT}`);
  } else {
    console.log('');
    console.log('  dry run - nothing written. Re-run with --apply.');
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
