/**
 * Does a real customer question find the chunk that answers it?
 *
 * The knowledge base is only as good as retrieval, and retrieval here has a
 * problem nova never had: pj's customers write romanised Sinhala - "komada
 * gasthu", "salli danne kohomda", "wade iwaraid" - while the answers are in
 * Sinhala script. Those are different enough that a question can embed poorly
 * against its own answer, and the failure is silent: the model gets unrelated
 * chunks, answers from memory, and quotes a price from two repricings ago.
 *
 * Every question below was actually sent by a customer, taken from the messages
 * table. Each names the chunk that should come back. The test asserts that
 * chunk is in the top 3, because the model sees several and reading the right
 * one is easier than being handed only the right one.
 *
 * Run it before and after changing chunks, aliases, or the embedding model.
 * A pass rate is worth more than an opinion about whether aliases help.
 *
 *   node scripts/test-kb-retrieval.js
 *   node scripts/test-kb-retrieval.js --verbose    # show what came back instead
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('../src/db');
const { embedText } = require('../src/services/embedder');

const CLIENT = process.env.KB_CLIENT || 'pj';
const VERBOSE = process.argv.includes('--verbose');
const TOP_N = 3;

/**
 * Real messages, verbatim, paired with the chunk that should answer them.
 * Keep adding to this as customers ask things the bot gets wrong — a failing
 * case here is cheaper to read than a bad conversation.
 */
const CASES = [
  // Price — the highest-volume intent, and almost always romanised
  ['komada gasthu',                              'faq_price_overview'],
  ['ගාස්තුව කීයද?',                                'faq_price_overview'],
  ['gana kiyada',                                'faq_price_overview'],
  ['Charges kohomada',                           'faq_price_overview'],
  ['Kiyak gnnwda hadahan parikshawata?',         'faq_price_overview'],
  ['Kendare balanna kiyak gannawada?',           'faq_price_overview'],
  ['Gasthuwa',                                   'faq_price_overview'],
  ['Price kohomada',                             'faq_price_overview'],
  ['1500 ට විවාහය ගැනත් සියලු තොරතුරු කියනවාද?',      'faq_does_full_report_cover_marriage'],

  // Payment
  ['Salli denna komada 1500',                    'faq_how_to_pay'],
  ['Salli danne kohomda',                        'faq_how_to_pay'],
  ['Salli dla inna onid',                        'faq_pay_before_or_after'],
  ['Gasthuwa Damma gewanna one da',              'faq_pay_before_or_after'],
  ['Salli dammata passeda kendara blnne',        'faq_pay_before_or_after'],
  ['peoples bank account number ekak nadda',     'faq_other_banks'],
  ['Mahaththaya mata b.o.c. account number ekak denawada', 'faq_other_banks'],
  ['Bank yanna one online nha',                  'faq_cannot_reach_bank_today'],
  ['Dan nam Salli danna bari wei..Town ekata yanna oni', 'faq_cannot_reach_bank_today'],
  ['Heta dawas bank deposit',                    'faq_cannot_reach_bank_today'],
  ['කොටස් වශයෙන් ගෙවන්න පුළුවන්ද',                   'faq_installments'],

  // Timing and status
  ['Dawas kiyakin denawada',                     'faq_delivery_time'],
  ['Dina kiyak yanawada',                        'faq_delivery_time'],
  ['මගේ විස්තර කවදා වගේ ගන්න පුලුවන් වේවිද?',        'faq_delivery_time'],
  ['Hri ada kiyata wageda denne?',               'faq_delivery_time'],
  ['අද 3 වෙනි දවස. මගේ වැඩේ තවම ඉවර නැද්ද?',        'faq_order_status'],
  ['Mage horoscope eke wade krn gmnd? Wade iwaraid?', 'faq_order_status'],
  ['Order ID kianne mokadda ?',                  'faq_order_id'],
  ['Mata oyalage link ekak ewanna puluwanda',    'faq_delivery_method'],

  // Birth details
  ['උපන් වේලාව දන්නේ නෑ',                          'faq_birth_time_unknown'],
  ['welawa hariyata danne naha',                 'faq_birth_time_unknown'],

  // Scope
  ['Hari, mage eken balann plwn trm balala kiann', 'faq_can_you_read_partner_from_my_chart'],
  ['පොඩි පැහැදිලි කිරීමක් කරන්න පුලුවන් ද',           'faq_followup_questions_after_report'],
  ['වාර්තාවේ මොනවද තියෙන්නේ',                       'faq_whats_in_the_report'],

  // Astrology concepts
  ['Shani මංගල දෝෂය කියන්නේ?',                     'kb_shani_mangala_dosha'],
  ['කාල සර්ප යෝගය කියන්නේ මොකක්ද',                  'kb_kala_sarpa_yoga'],
  ['කර්ම සබදතාවයක් කියන්නේ මොකක්ද',                  'kb_karma_sambandhata'],

  // Remedies
  ['Matath thel eka ganna puluwanda',            'faq_oil_thel'],
  ['Matath welawa balala Denna puluwanda',       'faq_nekath_auspicious_time'],
  ['Oya baudda neda',                            'faq_religion_of_remedies'],

  // Trust
  ['කවුද කේන්දරේ බලන්නේ',                          'faq_who_reads_the_chart'],
  ['salli apahu denawada',                       'faq_refund_policy'],
];

(async () => {
  if (!db.IS_PG) { console.error('This needs Postgres.'); process.exit(1); }

  const { rows: have } = await db.pgQuery(
    'SELECT title FROM client_knowledge_chunks WHERE client_id=$1', [CLIENT]);
  if (!have.length) {
    console.error(`  no knowledge chunks for ${CLIENT} — run load-kb-chunks.js first`);
    process.exit(1);
  }
  const titles = new Set(have.map(r => r.title));

  let hit = 0, top1 = 0, miss = 0;
  const failures = [];

  for (const [question, expected] of CASES) {
    if (!titles.has(expected)) {
      console.warn(`  ! no chunk named ${expected}, skipping "${question}"`);
      continue;
    }
    const emb = await embedText(question);
    const got = await db.vectorSearchKnowledge(CLIENT, emb, TOP_N);
    const names = got.map(g => g.title);
    const rank = names.indexOf(expected);

    if (rank === 0) { top1++; hit++; }
    else if (rank > 0) { hit++; }
    else { miss++; failures.push({ question, expected, names, sim: got[0]?.similarity }); }

    if (VERBOSE) {
      const mark = rank === 0 ? '1st' : rank > 0 ? `${rank + 1}` : 'MISS';
      console.log(`  ${mark.padStart(4)}  ${question.slice(0, 44).padEnd(46)} ${names.slice(0, 3).join(', ')}`);
    }
  }

  const total = hit + miss;
  console.log('');
  console.log(`  ${total} question(s) from real conversations`);
  console.log(`    found in top ${TOP_N} : ${hit}  (${Math.round(100 * hit / total)}%)`);
  console.log(`    top result exactly : ${top1}  (${Math.round(100 * top1 / total)}%)`);
  console.log(`    missed entirely    : ${miss}`);

  if (failures.length) {
    console.log('\n  missed — these would be answered from memory or not at all:');
    failures.forEach(f => {
      console.log(`    "${f.question}"`);
      console.log(`       wanted ${f.expected}`);
      console.log(`       got    ${f.names.join(', ') || '(nothing above the 0.35 threshold)'}`);
    });
    console.log('\n  usual fix: add how the customer phrased it to that chunk\'s ALIASES.');
  }

  process.exit(miss > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
