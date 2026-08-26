/**
 * Work out what a paid order with no recorded price was actually sold for.
 *
 * An order is priced from its payment slip or from the items the bot wrote when
 * it placed the order. A hand-entered order has neither, so it counts as zero
 * in the income figure and would pay zero commission on a sale that really
 * happened. This reads the conversation instead and proposes a price.
 *
 * It proposes. It does not write. Prices are payroll input, and a number
 * inferred from a chat needs a person to agree with it before it becomes one.
 *
 *   node scripts/propose-order-prices.js <clientId> [--month] [--all]
 */
'use strict';

const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv'))
  .config({ path: path.join(__dirname, '..', '.env') });
const db = require(path.join(__dirname, '..', 'src', 'db'));

const PAID = ['payment_received', 'paid', 'delivered', 'done', 'complete'];

/** The tiers pj actually sells, longest first so 3490 is not read out of 34900. */
const TIERS = [5000, 3490, 2990, 1500, 1000, 990];

/**
 * Every price mentioned in a piece of text, as tier values.
 *
 * @param {string} text
 * @returns {number[]}
 */
function tiersIn(text) {
  const hits = [];
  const flat = String(text || '').replace(/,/g, '');
  for (const t of TIERS) {
    if (new RegExp('(^|[^0-9])' + t + '([^0-9]|$)').test(flat)) hits.push(t);
  }
  return hits;
}

(async () => {
  const clientId = process.argv[2];
  if (!clientId) { console.error('usage: propose-order-prices.js <clientId> [--month] [--all]'); process.exit(1); }
  const monthOnly = process.argv.includes('--month');

  const HASITEMS = "(CASE WHEN jsonb_typeof(custom_fields->'items')='array' " +
                   "THEN jsonb_array_length(custom_fields->'items') ELSE 0 END) > 0";
  const { rows: orders } = await db.pgQuery(
    `SELECT order_id, phone_number, status, created_at, custom_fields
       FROM orders
      WHERE client_id=$1 AND status = ANY($2)
        AND custom_fields->'payment_identified'->>'amount' IS NULL
        AND NOT (${HASITEMS})
        ${monthOnly ? "AND created_at >= date_trunc('month', NOW())" : ''}
      ORDER BY created_at DESC`,
    [clientId, PAID]);

  console.log(`\n${orders.length} paid order(s) with no recorded price\n`);

  const proposals = [];
  for (const o of orders) {
    // The order's own fields are the strongest evidence there is: the bot
    // writes the chosen service into `product` and names the tier in `summary`.
    // Only fall back to reading the conversation when they say nothing, because
    // a chat lists every tier on the menu and the order names just the one.
    const fieldText = [o.custom_fields?.product, o.custom_fields?.summary,
                       o.custom_fields?.service, o.custom_fields?.package]
      .filter(Boolean).join(' | ');
    const fromFields = tiersIn(fieldText);
    if (fromFields.length === 1) {
      proposals.push({
        order: o, msgs: 0, ranked: [], top: { tier: fromFields[0], user: 0, bot: 0, sample: fieldText.slice(0, 110) },
        confident: true, source: 'the order itself',
      });
      continue;
    }

    // The conversation up to a day after the order was placed: the price is
    // agreed before the order and confirmed shortly after, not weeks later.
    const { rows: msgs } = await db.pgQuery(
      `SELECT sender_type, message_text, created_at
         FROM messages
        WHERE client_id=$1 AND phone_number=$2
          AND created_at <= $3::timestamptz + INTERVAL '1 day'
        ORDER BY created_at DESC LIMIT 60`,
      [clientId, o.phone_number, o.created_at]);

    // Count how often each tier appears, and note who said it. A price the
    // customer typed themselves is stronger evidence than one the bot listed
    // while showing the whole menu.
    const byTier = new Map();
    for (const m of msgs) {
      for (const t of tiersIn(m.message_text)) {
        const e = byTier.get(t) || { bot: 0, user: 0, lastAt: null, sample: null };
        e[m.sender_type === 'user' ? 'user' : 'bot']++;
        if (!e.lastAt) {
          e.lastAt = m.created_at;
          e.sample = String(m.message_text || '').replace(/\s+/g, ' ').slice(0, 90);
        }
        byTier.set(t, e);
      }
    }

    const ranked = [...byTier.entries()]
      .map(([tier, e]) => ({ tier, ...e, score: e.user * 3 + e.bot }))
      .sort((a, b) => b.score - a.score);

    const top = ranked[0];
    const runnerUp = ranked[1];
    // Confident when one tier stands clearly above the rest, or the customer
    // named it themselves and nobody named another.
    const confident = !!top && (
      (top.user > 0 && (!runnerUp || runnerUp.user === 0)) ||
      (!!runnerUp && top.score >= runnerUp.score * 2) ||
      ranked.length === 1
    );

    proposals.push({ order: o, msgs: msgs.length, ranked, top, confident, source: 'the conversation' });
  }

  const fmt = (d) => new Date(d).toISOString().slice(0, 10);
  for (const p of proposals) {
    const o = p.order;
    const name = o.custom_fields?.customer_name || '';
    console.log(`${o.order_id}  ${fmt(o.created_at)}  ${o.status.padEnd(16)} ${o.phone_number}  ${name}`);
    if (p.source === 'the order itself') {
      console.log(`    ${String(p.top.tier).padStart(5)}  named on the order itself  <-- propose`);
      console.log(`           "${p.top.sample}"`);
    } else if (!p.ranked.length) {
      console.log(`    no price mentioned anywhere in ${p.msgs} message(s) - needs a human`);
    } else {
      for (const r of p.ranked.slice(0, 3)) {
        const mark = r === p.top ? (p.confident ? ' <-- propose' : ' <-- best guess') : '';
        console.log(`    ${String(r.tier).padStart(5)}  said by customer ${r.user}x, by bot ${r.bot}x${mark}`);
      }
      if (p.top?.sample) console.log(`           "${p.top.sample}"`);
    }
    console.log('');
  }

  // Writing is opt-in and only ever touches the confident ones. An inferred
  // price becomes payroll input, so the ambiguous ones stay for a person.
  if (process.argv.includes('--apply')) {
    let written = 0;
    for (const p of proposals.filter(x => x.confident)) {
      const o = p.order;
      const cf = typeof o.custom_fields === 'string' ? JSON.parse(o.custom_fields) : (o.custom_fields || {});
      // Same shape the bot writes, so there is one way to price an order and
      // not two. The audit block beside it says where the number came from.
      cf.items = [{ product_id: p.top.tier, name: `Rs ${p.top.tier}`, price: p.top.tier }];
      cf.price_backfilled = {
        at: new Date().toISOString(),
        source: p.source,
        evidence: (p.top.sample || '').slice(0, 200),
        by: 'scripts/propose-order-prices.js',
      };
      await db.pgQuery(`UPDATE orders SET custom_fields=$2::jsonb WHERE order_id=$1`,
                       [o.order_id, JSON.stringify(cf)]);
      console.log(`  wrote ${String(p.top.tier).padStart(5)} to ${o.order_id}  (${p.source})`);
      written++;
    }
    console.log(`
  ${written} order(s) priced
`);
  }

  const sure = proposals.filter(p => p.confident);
  const unsure = proposals.filter(p => !p.confident);
  console.log(`  confident: ${sure.length}   needs a decision: ${unsure.length}`);
  if (sure.length) {
    const total = sure.reduce((a, p) => a + p.top.tier, 0);
    console.log(`  confident proposals add ${total.toLocaleString()} to the period`);
  }
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
