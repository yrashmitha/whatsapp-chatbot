/**
 * Put pj's prices back to රු. 2,990 (marriage / porondam-with-graha) and
 * රු. 3,490 (full life report). 990 is unchanged.
 *
 * The 25 August reprice dropped both to 1,500 across three stores; this
 * reverses the same three, plus:
 *   - drops the fake "සාමාන්‍ය ගාස්තුව ~රු. X~ / අද දිනට පමණක්" strike-through
 *     in the detail blocks — the price is now stated plainly, once, with the
 *     list of what the report covers that already sits in the block
 *   - tightens the prompt so a price never goes out as a bare figure: it only
 *     ever travels inside a service block, next to what that service delivers
 *
 * Every edit is an exact string swap — it fires on the repriced text or not
 * at all. Dry run by default; --apply writes after dumping the current prompt
 * and blocks to scripts/price-backup-<timestamp>.json.
 *
 *   node backend/scripts/restore-prices.js
 *   node backend/scripts/restore-prices.js --apply
 */

'use strict';

const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('../src/db');

const CLIENT = process.env.RESTORE_CLIENT || 'pj';
const APPLY  = process.argv.includes('--apply');

// ── client_configs.custom_prompt ────────────────────────────────────────────
const PROMPT_SUBS = [
  ['classify as 1500 inquiry ("විසි පොරොන්දම්',
   'classify as 2990 inquiry ("විසි පොරොන්දම්'],
  ['Directly present the combined 1500 tier solution',
   'Directly present the combined 2990 tier solution'],
  ['දෙදෙනාගේම කේන්දර සසඳන රු. 1500 (විසි පොරොන්දම් + පූර්ණ ග්‍රහ ගැලපීම)',
   'දෙදෙනාගේම කේන්දර සසඳන රු. 2990 (විසි පොරොන්දම් + පූර්ණ ග්‍රහ ගැලපීම)'],
  ['recommend Option 3 (1500 tier). If they want a general full life reading covering all their personal areas (including marriage/career), recommend Option 2 (1500 full report).',
   'recommend Option 3 (2990 tier). If they want a general full life reading covering all their personal areas (including marriage/career), recommend Option 2 (3490 full report).'],
  ['Explain that checking multiple personal life areas together is fully covered under the 1500 Full Life Report (Option 2), whereas 990 covers only 1 area and 1500 is dedicated solely to marriage.',
   'Explain that checking multiple personal life areas together is fully covered under the 3490 Full Life Report (Option 2), whereas 990 covers only 1 area and 2990 is dedicated solely to marriage.'],
  ['Guide them directly to choose 1500 for complete coverage, or pick just one main focus area for 990 or 1500.',
   'Guide them directly to choose 3490 for complete coverage, or pick just one main focus area for 990/2990.'],
  ['විවාහය සඳහා රු. 1500 සේවාව',
   'විවාහය සඳහා රු. 2990 සේවාව'],
  ['- රු. 1500: "පූර්ණ විවාහ කේන්දර විශ්ලේෂණය"',
   '- රු. 2990: "පූර්ණ විවාහ කේන්දර විශ්ලේෂණය"'],
  ['- රු. 1500: Full report covering all 11 major life areas',
   '- රු. 3490: Full report covering all 11 major life areas'],
  ['- රු. 1500: "විසි පොරොන්දම් + ග්‍රහ ගැලපීම"',
   '- රු. 2990: "විසි පොරොන්දම් + ග්‍රහ ගැලපීම"'],
  ['ගැඹුරු විශ්ලේෂණයක් තමයි 1500 සේවාව." Then offer the choice warmly: move to 1500 for the full marriage-life analysis',
   'ගැඹුරු විශ්ලේෂණයක් තමයි 2990 සේවාව." Then offer the choice warmly: move to 2990 for the full marriage-life analysis'],
  ['පූර්ණ ග්‍රහ ගැලපීමක් (රු. 1500 සේවාව) සිදු කරන්න ඕනේ.',
   'පූර්ණ ග්‍රහ ගැලපීමක් (රු. 2990 සේවාව) සිදු කරන්න ඕනේ.'],
  ['naming what they want: "රැකියාව", "1500", "2990", "විවාහය", "අධ්‍යාපනය"',
   'naming what they want: "රැකියාව", "2990", "විවාහය", "අධ්‍යාපනය"'],

  // A price is never a bare number — it always travels with the service and
  // what that service delivers.
  ['  - a figure with රු. in front of it, outside of answering a direct question',
   '  - a figure with රු. in front of it — the price only ever goes out inside\n    a service block, stated next to what that report covers'],
  ['A price question after they have chosen is answered with that one price and\nnothing else. Do not use it as a reason to re-open the menu.',
   "A price question after they have chosen is answered by resending that\nservice's details block, which states the fee alongside what the report\ncovers. Never send the figure on its own. Do not use it as a reason to\nre-open the menu."],
  ['If they ask the price outright ("ගාණ කීයද?"), answer plainly from CORE FACTS.\nA direct question always gets a direct answer. What you never do is volunteer\nthe number before they have agreed.',
   'If they ask the price outright ("ගාණ කීයද?") before choosing a service, do\nnot send a bare figure. Give one line on the service and what it covers, then\nthe fee — or resend their service block, which already does both. What you\nnever do is volunteer the number before they have chosen a service.'],
  ['- Answer briefly from CORE FACTS, in one or two lines.',
   '- Answer briefly, in one or two lines. A price never goes out as a number\n    on its own — always with the service name and what that service covers.'],
  ["THE 50% IS THE PRICE THEY WERE ALREADY QUOTED. The template shows the usual\nfee struck through against today's fee - 3,000 against 1,500, or 2,000 against\n990. It is not half off today's price. Never quote half of 1,500. If they ask\nwhat the discounted price is, it is the same figure the service block gives.",
   "THE 50% IS THE PRICE THEY WERE ALREADY QUOTED. The template shows a usual fee\nstruck through against a reduced fee. It is not half off today's price. Never\ndo the arithmetic yourself. If they ask what the discounted price is, it is\nthe same figure the service block gives."],
];

// ── quick_replies (per title, exact swaps) ──────────────────────────────────
const STRIKE_2990 = '• සාමාන්‍ය ගාස්තුව: ~රු. 3,000~\n• *අද දිනට පමණක්: රු. 1,500යි*';
const STRIKE_990  = '• සාමාන්‍ය ගාස්තුව: ~රු. 2,000~\n• *අද දිනට පමණක්: රු. 990යි*';

const BLOCK_SUBS = {
  '2990-details': [[STRIKE_2990, '• *ගාස්තුව: රු. 2,990යි*']],
  '3490-details': [[STRIKE_2990, '• *ගාස්තුව: රු. 3,490යි*']],
  '990-details':  [[STRIKE_990,  '• *ගාස්තුව: රු. 990යි*']],
  'porondam-details': [
    [STRIKE_990,  '• *ගාස්තුව: රු. 990යි*'],
    [STRIKE_2990, '• *ගාස්තුව: රු. 2,990යි*'],
  ],
  'price1': [
    ['👑 රු. 1500 සේවාව: සම්පූර්ණ ජීවන වාර්තාව', '👑 රු. 3,490 සේවාව: සම්පූර්ණ ජීවන වාර්තාව'],
    ['💍 රු. 1500 සේවාව: පූර්ණ විවාහ කේන්දර විශ්ලේෂණය', '💍 රු. 2,990 සේවාව: පූර්ණ විවාහ කේන්දර විශ්ලේෂණය'],
  ],
  'price3': [
    ['💍 රු. 1500 (නිර්දේශිත): විසි පොරොන්දම් + පූර්ණ ග්‍රහ ගැලපීම', '💍 රු. 2,990 (නිර්දේශිත): විසි පොරොන්දම් + පූර්ණ ග්‍රහ ගැලපීම'],
  ],
};

function applySubs(text, subs) {
  let out = text, hits = 0, misses = [];
  for (const [from, to] of subs) {
    if (out.includes(from)) { out = out.split(from).join(to); hits++; }
    else misses.push(from.split('\n')[0].slice(0, 55));
  }
  return { out, hits, misses };
}

(async () => {
  if (!db.IS_PG) { console.error('Needs Postgres — run where DATABASE_URL points at prod.'); process.exit(1); }

  // 1. Prompt
  const { rows: cfg } = await db.pgQuery('SELECT custom_prompt FROM client_configs WHERE client_id=$1', [CLIENT]);
  if (!cfg.length) { console.error(`No client_configs row for "${CLIENT}"`); process.exit(1); }
  // The stored prompt uses CRLF; match and write back on LF so the multi-line
  // swaps land. Line endings are irrelevant to the model.
  const prompt = (cfg[0].custom_prompt || '').replace(/\r\n/g, '\n');
  const { out: nextPrompt, hits: pHits, misses: pMiss } = applySubs(prompt, PROMPT_SUBS);
  console.log(`\n── prompt (${CLIENT}) — ${pHits}/${PROMPT_SUBS.length} edits matched`);
  pMiss.forEach(m => console.log(`   (not found) ${m}…`));
  const left = [...new Set(nextPrompt.match(/රු\.?\s?1[,.]?500/g) || [])];
  if (left.length) console.log(`   ⚠ still mentions: ${left.join(', ')} — check by hand`);

  // 2. Blocks
  const { rows: blocks } = await db.pgQuery('SELECT id, title, text FROM quick_replies WHERE client_id=$1 ORDER BY title', [CLIENT]);
  console.log(`\n── quick reply blocks (${CLIENT})`);
  const updates = [];
  for (const b of blocks) {
    const subs = BLOCK_SUBS[b.title.toLowerCase()];
    if (!subs) {
      if (/1[,.]?500/.test(b.text)) console.log(`   ⚠ "${b.title}" mentions 1500 but has no rule — check by hand`);
      continue;
    }
    const { out, hits, misses } = applySubs((b.text || '').replace(/\r\n/g, '\n'), subs);
    if (hits) { console.log(`   ✓ "${b.title}" — ${hits} edit(s)`); updates.push({ id: b.id, title: b.title, text: out }); }
    misses.forEach(m => console.log(`   (not found in "${b.title}") ${m}…`));
    if (/1[,.]?500/.test(out)) console.log(`   ⚠ "${b.title}" still mentions 1500 after edits`);
  }
  if (!updates.length) console.log('   nothing to change');

  // 3. KB (report only)
  const { rows: kb } = await db.pgQuery(
    `SELECT id, title FROM client_knowledge_chunks WHERE client_id=$1 AND content ~ '1[,.]?500'`, [CLIENT]);
  console.log(`\n── knowledge base (${CLIENT})`);
  if (!kb.length) console.log('   clean');
  else kb.forEach(c => console.log(`   note: chunk "${c.title}" (id ${c.id}) — fix pj-chunks.json + re-run load-kb-chunks.js`));

  if (!APPLY) { console.log('\n  dry run — nothing written. Re-run with --apply.\n'); process.exit(0); }

  const backup = path.join(__dirname, `price-backup-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify({ client: CLIENT, custom_prompt: prompt, quick_replies: blocks }, null, 2));
  console.log(`\n  backup: ${backup}`);
  if (nextPrompt !== prompt) {
    await db.pgQuery('UPDATE client_configs SET custom_prompt=$1 WHERE client_id=$2', [nextPrompt, CLIENT]);
    console.log('  prompt updated');
  }
  for (const u of updates) {
    await db.pgQuery('UPDATE quick_replies SET text=$1 WHERE id=$2', [u.text, u.id]);
    console.log(`  block "${u.title}" updated`);
  }
  console.log('\n  done. Now run: node backend/scripts/check-prompt-blocks.js\n');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
