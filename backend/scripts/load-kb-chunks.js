/**
 * Load a structured knowledge base from JSON, one chunk per topic.
 *
 * The old knowledge base was four long documents fed through a fixed-size
 * splitter, which packed five different service prices into one blob. Retrieved
 * for "how much is the marriage report", it handed the model all five, and the
 * model picked wrong. One topic per chunk is the fix, and it only works if the
 * chunks are authored that way rather than cut that way.
 *
 * Each entry becomes a chunk shaped like nova's, which is the working reference:
 *
 *   ## CHUNK ID: faq_how_to_pay
 *   [NOTE: INTENT: payment]
 *   [NOTE: ALIASES: salli danne kohomda, how to pay, ...]
 *   [NOTE: SEND_BLOCK: payment-howto]
 *   [NOTE: EXACT_RESPONSE]
 *
 *   <the answer>
 *
 * ALIASES is the part that earns its keep here and not at nova. pj's customers
 * write romanised Sinhala - "komada gasthu", "salli danne kohomda", "wade
 * iwaraid" - while the answers are in Sinhala script. Those are different
 * enough that a query embeds poorly against its own answer. Listing the
 * romanised forms inside the chunk puts them in the same embedding, so the
 * query lands.
 *
 * Dry run by default.
 *
 *   node scripts/load-kb-chunks.js
 *   node scripts/load-kb-chunks.js --apply
 *   node scripts/load-kb-chunks.js --apply --replace   # delete old chunks first
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const db = require('../src/db');
const { embedText } = require('../src/services/embedder');
const { chunkText } = require('../src/services/chunker');

const CLIENT = process.env.KB_CLIENT || 'pj';
const APPLY = process.argv.includes('--apply');
const REPLACE = process.argv.includes('--replace');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const SRC = arg('--file', path.join(__dirname, 'kb', `${CLIENT}-chunks.json`));

/**
 * Turn one JSON entry into the chunk text that gets embedded and stored.
 *
 * The notes are part of the body rather than separate columns, deliberately:
 * they are embedded with the text, they need no schema change, and the model
 * reads them directly. That is how nova does it and it has held up.
 *
 * @param {object} c
 * @returns {string}
 */
function render(c) {
  const lines = [`## CHUNK ID: ${c.id}`];
  if (c.intent) lines.push(`[NOTE: INTENT: ${c.intent}]`);
  if (c.aliases) lines.push(`[NOTE: ALIASES: ${c.aliases}]`);
  // A price belongs in the block, never in a chunk. The chunk says which block.
  if (c.send) lines.push(`[NOTE: SEND_BLOCK: ${c.send}]`);
  if (c.exact) lines.push('[NOTE: EXACT_RESPONSE]');
  lines.push('', c.body.trim());
  return lines.join('\n');
}

(async () => {
  if (!db.IS_PG) { console.error('This needs Postgres.'); process.exit(1); }
  if (!fs.existsSync(SRC)) { console.error(`No such file: ${SRC}`); process.exit(1); }

  const doc = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const chunks = doc.chunks || [];
  if (!chunks.length) { console.error('No chunks in that file.'); process.exit(1); }

  // Catch the mistakes that only show up as a bad answer weeks later.
  const seen = new Set();
  const problems = [];
  for (const c of chunks) {
    if (!c.id || !/^[a-z0-9_]+$/.test(c.id)) problems.push(`bad id: ${c.id}`);
    if (seen.has(c.id)) problems.push(`duplicate id: ${c.id}`);
    seen.add(c.id);
    if (!c.body || c.body.trim().length < 20) problems.push(`${c.id}: body too short`);
    // A figure in a chunk is the bug this whole exercise exists to stop. A
    // local phone number (0 + 9 digits) is not a figure of that kind, so it is
    // stripped before the check rather than forced into a quick-reply block.
    const digits = (c.body.replace(/\b0\d{9}\b/g, '').match(/\b\d{3,}\b/g) || []);
    if (digits.length) problems.push(`${c.id}: contains a figure (${digits.join(', ')}) — prices belong in blocks`);
    if (render(c).length > 1400) problems.push(`${c.id}: over 1400 chars, split it`);
  }
  if (problems.length) {
    console.error('  refusing to load:');
    problems.forEach(p => console.error(`    ${p}`));
    process.exit(1);
  }

  // Every block a chunk points at must exist, or the answer goes out short.
  const { rows: qr } = await db.pgQuery(
    'SELECT LOWER(title) t FROM quick_replies WHERE client_id=$1', [CLIENT]);
  const blocks = new Set(qr.map(r => r.t));
  const missing = chunks.filter(c => c.send && !blocks.has(c.send.toLowerCase()));
  if (missing.length) {
    console.error('  these chunks name a block that does not exist:');
    missing.forEach(c => console.error(`    ${c.id} -> ${c.send}`));
    process.exit(1);
  }

  const byIntent = chunks.reduce((m, c) => {
    (m[c.intent || 'none'] = m[c.intent || 'none'] || []).push(c.id); return m;
  }, {});
  console.log(`  ${chunks.length} chunk(s) from ${path.basename(SRC)}\n`);
  for (const [intent, ids] of Object.entries(byIntent)) {
    console.log(`    ${intent.padEnd(10)} ${ids.length.toString().padStart(2)}  ${ids.join(', ')}`);
  }

  const exact = chunks.filter(c => c.exact).length;
  const sends = chunks.filter(c => c.send).length;
  console.log(`\n    ${exact} marked EXACT_RESPONSE, ${sends} point at a block`);
  console.log(`    average ${Math.round(chunks.reduce((t, c) => t + render(c).length, 0) / chunks.length)} chars`);

  if (!APPLY) {
    console.log('\n  dry run - nothing written. Re-run with --apply.');
    console.log('  --replace also removes the existing chunks first.');
    process.exit(0);
  }

  if (REPLACE) {
    const { rowCount } = await db.pgQuery(
      'DELETE FROM client_knowledge_chunks WHERE client_id=$1', [CLIENT]);
    console.log(`\n  removed ${rowCount} existing chunk(s)`);
  }

  let done = 0;
  for (const c of chunks) {
    const text = render(c);
    // Through the real chunker, so a structured document that somehow fails the
    // whole-document rule is caught here rather than in production.
    const parts = chunkText(text);
    if (parts.length !== 1) {
      console.warn(`    ${c.id}: split into ${parts.length} parts — skipped`);
      continue;
    }
    const embedding = await embedText(parts[0]);
    await db.pgQuery(
      `INSERT INTO client_knowledge_chunks (client_id, title, content, embedding)
       VALUES ($1,$2,$3,$4::vector)`,
      [CLIENT, c.id, parts[0], JSON.stringify(embedding)]
    );
    done++;
    process.stdout.write(`\r    embedded ${done}/${chunks.length}`);
  }
  console.log(`\n\n  loaded ${done} chunk(s) for ${CLIENT}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
