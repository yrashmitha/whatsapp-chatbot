/**
 * Bring the knowledge base's prices in line with what is actually charged.
 *
 * The reprice on 25 August moved the quick reply blocks and the prompt, and
 * missed the knowledge base. The FAQ chunk states the prices outright, so when
 * a customer asks "ගාස්තු කීයද" the bot searches its knowledge, finds the old
 * figure and quotes it. On 27 August one customer was quoted 1,500 and two were
 * quoted 3,490 within the same hour - the difference being whether the answer
 * came from the repriced block or from this.
 *
 * It is not only a quoting problem any more. The bot now records the price it
 * quoted onto the order, and that figure is reported to Meta as the value of
 * the sale, so a stale price becomes stale revenue in the ad platform too.
 *
 * The chunk is re-embedded after editing. An edit without that leaves the
 * search index pointing at the old wording, which is the same class of mistake
 * as the original.
 *
 * Dry run by default. Pass --apply to write.
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('../src/db');
const { embedText } = require('../src/services/embedder');

const CLIENT = process.env.REPRICE_CLIENT || 'pj';
const APPLY  = process.argv.includes('--apply');

/**
 * What changed on 25 August.
 *
 * 990 is deliberately absent: the single-area service and the twenty-porondam
 * check are still 990, and a blanket number swap would have moved them too.
 */
const CHANGES = [
  { from: 'රු. 3490', to: 'රු. 1500', what: 'the full life report' },
  { from: 'රු. 2990', to: 'රු. 1500', what: 'marriage, and porondam with full graha matching' },
];

(async () => {
  if (!db.IS_PG) { console.error('This needs Postgres.'); process.exit(1); }

  const { rows } = await db.pgQuery(
    `SELECT id, title, content FROM client_knowledge_chunks
      WHERE client_id = $1 AND content ~ '3490|2990'`,
    [CLIENT]
  );

  if (!rows.length) { console.log('  no chunk carries an old price'); process.exit(0); }

  let touched = 0;
  for (const row of rows) {
    let next = row.content;
    const applied = [];
    for (const c of CHANGES) {
      const n = next.split(c.from).length - 1;
      if (n) { next = next.split(c.from).join(c.to); applied.push(`${n}x ${c.from} -> ${c.to}  (${c.what})`); }
    }

    // A bare number with no "රු." in front is a service being referred to by
    // its old name rather than a price being quoted. Renaming those is a
    // content decision, not a repricing one, so they are reported and left.
    const leftover = (next.match(/(?<!රු\. )\b(3490|2990)\b/g) || []).length;

    if (!applied.length) continue;
    touched++;
    console.log(`\n  [chunk ${row.id}] ${row.title}`);
    applied.forEach(a => console.log(`     ${a}`));
    if (leftover) {
      console.log(`     note: ${leftover} bare mention(s) of an old number remain - these name a`);
      console.log(`           service rather than quote a price. Reword them by hand if they mislead.`);
    }

    if (APPLY) {
      // Re-embed, or search keeps matching the old wording.
      let embedding = null;
      try {
        embedding = await embedText(next);
      } catch (e) {
        console.warn(`     could not re-embed: ${e.message} — leaving this chunk alone`);
        continue;
      }
      await db.pgQuery(
        `UPDATE client_knowledge_chunks SET content = $1, embedding = $2 WHERE id = $3`,
        [next, JSON.stringify(embedding), row.id]
      );
      console.log('     updated and re-embedded');
    }
  }

  console.log('');
  console.log(APPLY ? `  applied to ${touched} chunk(s)` : '  dry run - nothing written. Re-run with --apply.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
