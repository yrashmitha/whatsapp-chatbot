/**
 * Move the figures out of the service blocks and into the fields beside them.
 *
 * The blocks currently spell their prices out in Sinhala prose, which is why
 * the reprice on the 25th took nine edits and still left four behind - the bot
 * was quoting 3,490 the following morning. After this the number is typed once,
 * in the price field, and the sentence writes {{price}} and {{anchor}}.
 *
 * The wording is untouched. Only the digits are replaced, and only where they
 * match the price this block is being given, so a figure that means something
 * else - a page count, a phone number - is left alone.
 *
 * Dry run by default. Pass --apply to write.
 *
 *   node scripts/tokenise-block-prices.js            # show what would change
 *   node scripts/tokenise-block-prices.js --apply
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('../src/db');

const CLIENT = process.env.TOKENISE_CLIENT || 'pj';
const APPLY  = process.argv.includes('--apply');

/**
 * What each block sells.
 *
 * A key is what place_order records and what commission is paid against, so it
 * is named for the service rather than for a price that has already changed
 * once. The block titles keep their old numeric names because the prompt
 * refers to them by name and renaming them there is a separate, riskier change.
 */
const PLAN = [
  {
    title: '990-details',
    services: [{ key: 'single-area', label: 'එක අංශයකට පිළිතුරක්', price: 990, anchor: 2000 }],
  },
  {
    title: '2990-details',
    services: [{ key: 'life-report', label: 'සම්පූර්ණ ජීවන වාර්තාව', price: 1500, anchor: 3000 }],
  },
  {
    title: '3490-details',
    services: [{ key: 'life-report-plus', label: 'සම්පූර්ණ ජීවන වාර්තාව (විස්තරාත්මක)', price: 1500, anchor: 3000 }],
  },
  {
    // One message, two tiers, so its tokens have to name which.
    title: 'porondam-details',
    services: [
      { key: 'porondam-basic', label: 'විසි පොරොන්දම් පරීක්ෂාව', price: 990, anchor: 2000 },
      { key: 'porondam-full',  label: 'පූර්ණ ග්‍රහ සහ පොරොන්දම් ගැලපීම', price: 1500, anchor: 3000 },
    ],
  },
];

/** 1500 -> /1[,.]?500/, so both "1,500" and "1500" are found. */
function figureRe(n) {
  const plain = String(n);
  const grouped = Number(n).toLocaleString('en-US');
  const alts = [...new Set([grouped, plain])].map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp('(?<![0-9])(?:' + alts.join('|') + ')(?![0-9])', 'g');
}

/**
 * Replace this block's own figures with tokens.
 *
 * A block with one service uses the bare {{price}}; a block with more must name
 * the service, or the first one would silently answer for both.
 */
function tokenise(text, services) {
  const named = services.length > 1;
  let out = text;
  const hits = [];

  for (const svc of services) {
    for (const [field, value] of [['price', svc.price], ['anchor', svc.anchor]]) {
      if (value == null) continue;
      const token = named ? `{{${field}:${svc.key}}}` : `{{${field}}}`;
      const re = figureRe(value);
      const before = out;
      // Only the first occurrence per service, so a figure that appears twice
      // for different reasons does not get swept up by the second pass.
      let replaced = false;
      out = out.replace(re, (m) => {
        if (replaced) return m;
        replaced = true;
        return token;
      });
      if (out !== before) hits.push(`${value} -> ${token}`);
      else console.warn(`    ! ${svc.key}: no "${value}" found in the text`);
    }
  }
  return { text: out, hits };
}

(async () => {
  if (!db.IS_PG) {
    console.error('This needs Postgres. Set DATABASE_URL.');
    process.exit(1);
  }

  let changed = 0;
  for (const item of PLAN) {
    const { rows } = await db.pgQuery(
      'SELECT id, title, text, services FROM quick_replies WHERE client_id=$1 AND title=$2',
      [CLIENT, item.title]
    );
    if (!rows.length) {
      console.warn(`\n  ${item.title}: no such block for ${CLIENT}, skipping`);
      continue;
    }
    const row = rows[0];
    console.log(`\n  ${item.title}`);

    if (/\{\{(price|anchor)/.test(row.text)) {
      console.log('    already tokenised, leaving the text alone');
    }
    const { text, hits } = /\{\{(price|anchor)/.test(row.text)
      ? { text: row.text, hits: [] }
      : tokenise(row.text, item.services);

    hits.forEach(h => console.log(`    ${h}`));
    item.services.forEach(s =>
      console.log(`    sells ${s.key} = LKR ${s.price}${s.anchor ? ` (usual ${s.anchor})` : ''}`));

    if (APPLY) {
      await db.pgQuery(
        'UPDATE quick_replies SET text=$1, services=$2 WHERE id=$3 AND client_id=$4',
        [text, JSON.stringify(item.services), row.id, CLIENT]
      );
      changed++;
    }
  }

  console.log('');
  console.log(APPLY
    ? `  applied to ${changed} block(s)`
    : '  dry run - nothing written. Re-run with --apply.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
