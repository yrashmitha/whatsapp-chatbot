/**
 * Every block the prompt names must exist, or the message goes out with a hole.
 *
 * resolveBlocks removes a marker it cannot resolve rather than leaving braces in
 * a customer's message, which is right - but it means a renamed or deleted quick
 * reply shows up as a short, oddly abrupt message and nothing else. This is the
 * check that catches it before a customer does.
 *
 *   node scripts/check-prompt-blocks.js
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('../src/db');

const CLIENT = process.env.CHECK_CLIENT || 'pj';

(async () => {
  const { rows } = await db.pgQuery(
    'SELECT custom_prompt FROM client_configs WHERE client_id=$1', [CLIENT]);
  const prompt = rows[0]?.custom_prompt || '';
  const named = [...new Set([...prompt.matchAll(/\[\[QR:([a-z0-9_-]+)\]\]/gi)]
    .map(m => m[1].toLowerCase()))]
    // The syntax explanation uses [[QR:name]] as a placeholder, not a block.
    .filter(n => n !== 'name');

  const { rows: have } = await db.pgQuery(
    'SELECT LOWER(title) t FROM quick_replies WHERE client_id=$1', [CLIENT]);
  const set = new Set(have.map(r => r.t));

  const missing = named.filter(n => !set.has(n));
  const unused = [...set].filter(t => !named.includes(t));

  console.log(`  ${named.length} block(s) named by the prompt`);
  if (missing.length) {
    console.log(`  MISSING — these would send an empty message: ${missing.join(', ')}`);
  } else {
    console.log('  all of them exist');
  }
  if (unused.length) {
    console.log(`\n  blocks the prompt never names (fine for operator-only replies,`);
    console.log(`  a problem if the prompt writes the same words out longhand):`);
    unused.forEach(u => console.log(`    ${u}`));
  }
  process.exit(missing.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
