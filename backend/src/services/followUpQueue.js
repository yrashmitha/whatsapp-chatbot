/**
 * @module services/followUpQueue
 * @description Who should be messaged right now, and what to say to them.
 *
 * Built from a look at 142 customers who placed an order and never paid. Almost
 * none of them refused: 18% said outright that they would pay later ("heta
 * dannam", "Town ගියාම දාලා"), 22% acknowledged the bank details and drifted,
 * and only 1% declined. They stayed in the conversation for three and a half
 * hours on average after ordering. They were not lost at the price — they were
 * lost in the gap between meaning to pay and getting to a bank, with nobody
 * reminding them.
 *
 * Two kinds of signal decide the queue, deliberately kept apart:
 *
 *   Facts come from the database — did they read our last message, did they
 *   give their birth details, is the last word theirs, how long is left in the
 *   24-hour window. These are never guessed, never wrong, and cost nothing.
 *
 *   Intent comes from the model, because it arrives as Sinhala, Singlish,
 *   typos and voice transcripts, and matching keywords against that missed a
 *   third of real cases when it was measured.
 */

'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('../db');
const { getGeminiKey } = require('./clientKeys');

/** WhatsApp's free-form reply window. */
const WINDOW_HOURS = 24;

/** Leave someone alone this long after their last message before chasing. */
const QUIET_MINUTES = 90;

/** Below this many hours left, it is the last realistic chance to reach them. */
const CLOSING_SOON_HOURS = 4;

/** How many candidates to classify at once. One call each, run in parallel. */
const CONCURRENCY = 4;

/** Re-classifying an unchanged conversation buys nothing. */
const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Every pending order whose customer can still be messaged for free.
 *
 * @param {string} clientId
 * @returns {Promise<Array<Object>>} raw rows, newest activity first
 */
async function loadCandidates(clientId) {
  const { rows } = await db.pgQuery(
    `SELECT
       o.order_id,
       o.created_at                AS order_at,
       o.custom_fields,
       o.remarks,
       c.phone_number,
       c.name,
       c.last_customer_message_at  AS last_in_at,
       EXTRACT(EPOCH FROM (NOW() - c.last_customer_message_at)) / 3600 AS hours_since_in,
       EXTRACT(EPOCH FROM (NOW() - o.created_at))                / 3600 AS hours_since_order,
       lin.message_text            AS last_in_text,
       lout.message_text           AS last_out_text,
       lout.created_at             AS last_out_at,
       lout.delivery_status        AS last_out_status,
       lout.read_at                AS last_out_read_at,
       (SELECT COUNT(*) FROM messages m
         WHERE m.phone_number = c.phone_number AND m.client_id = c.client_id
           AND m.sender_type = 'bot' AND m.created_at > c.last_customer_message_at)::int AS chased_since,
       (SELECT COUNT(*) FROM messages m
         WHERE m.phone_number = c.phone_number AND m.client_id = c.client_id
           AND m.sender_type = 'user')::int AS total_in
     FROM orders o
     JOIN customers c
       ON c.phone_number = o.phone_number AND c.client_id = o.client_id
     LEFT JOIN LATERAL (
       SELECT message_text FROM messages m
        WHERE m.phone_number = o.phone_number AND m.client_id = o.client_id
          AND m.sender_type = 'user'
        ORDER BY m.id DESC LIMIT 1
     ) lin ON TRUE
     LEFT JOIN LATERAL (
       SELECT message_text, created_at, delivery_status, read_at FROM messages m
        WHERE m.phone_number = o.phone_number AND m.client_id = o.client_id
          AND m.sender_type = 'bot'
        ORDER BY m.id DESC LIMIT 1
     ) lout ON TRUE
     WHERE o.client_id = $1
       AND o.status = 'pending'
       AND c.last_customer_message_at IS NOT NULL
       AND c.last_customer_message_at > NOW() - ($2 || ' hours')::interval
     ORDER BY c.last_customer_message_at DESC`,
    [clientId, WINDOW_HOURS]
  );
  return rows;
}

/**
 * The facts about one candidate, before anyone has interpreted anything.
 *
 * @param {Object} row
 * @returns {Object}
 */
function factsFor(row) {
  const hoursLeft = Math.max(0, WINDOW_HOURS - Number(row.hours_since_in || 0));
  const cf = row.custom_fields && typeof row.custom_fields === 'object' ? row.custom_fields : {};
  const given = Object.entries(cf)
    .filter(([k, v]) => v && String(v).trim() && !['package', 'product_id', 'summary'].includes(k))
    .map(([k]) => k);

  // Whether the last word was theirs matters more than anything the model can
  // infer: if it was, we owe them a reply and never sent one.
  const theySpokeLast = Number(row.chased_since || 0) === 0;

  const readOurLast = row.last_out_status === 'read';
  const minutesQuiet = Math.round(Number(row.hours_since_in || 0) * 60);

  return {
    orderId: row.order_id,
    phone: row.phone_number,
    name: row.name || null,
    hoursLeft: Math.round(hoursLeft * 10) / 10,
    minutesQuiet,
    hoursSinceOrder: Math.round(Number(row.hours_since_order || 0) * 10) / 10,
    detailsGiven: given,
    theySpokeLast,
    chasedSince: Number(row.chased_since || 0),
    totalMessagesFromThem: Number(row.total_in || 0),
    lastFromThem: (row.last_in_text || '').slice(0, 400),
    lastFromUs: (row.last_out_text || '').slice(0, 300),
    lastFromUsStatus: row.last_out_status || 'unknown',
    readOurLast,
    readAt: row.last_out_read_at || null,
    package: cf.package || cf.product_id || null,
    remarks: Array.isArray(row.remarks) ? row.remarks.map(r => r.text).slice(-3) : [],
    // Due once they have been quiet a while and nobody has chased since.
    due: minutesQuiet >= QUIET_MINUTES && Number(row.chased_since || 0) === 0,
    closingSoon: hoursLeft <= CLOSING_SOON_HOURS,
  };
}

/**
 * The block of facts handed to the model for one candidate.
 *
 * @param {Object} f
 * @returns {string}
 */
function describe(f) {
  const lines = [
    `order ${f.orderId}${f.package ? ` (Rs. ${f.package})` : ''}`,
    `  placed ${f.hoursSinceOrder}h ago`,
    `  they have been quiet for ${f.minutesQuiet} minutes; ${f.hoursLeft}h left before we can no longer message them freely`,
    `  birth details on file: ${f.detailsGiven.length ? f.detailsGiven.join(', ') : 'none'}`,
    `  messages they have sent in total: ${f.totalMessagesFromThem}`,
    `  last thing THEY said: "${f.lastFromThem || '(nothing)'}"`,
    `  last thing WE said: "${f.lastFromUs || '(nothing)'}"`,
    `  they ${f.readOurLast ? 'HAVE read' : `have NOT read (status: ${f.lastFromUsStatus})`} our last message`,
    f.theySpokeLast
      ? '  THEY SPOKE LAST and we never replied'
      : `  we have sent ${f.chasedSince} message(s) since they last spoke`,
  ];
  if (f.remarks.length) lines.push(`  operator notes: ${f.remarks.join(' | ')}`);
  return lines.join('\n');
}

const SYSTEM = `You triage a follow-up queue for a Sri Lankan astrology business.

Every person listed placed an order and has not paid. They are all still
reachable. Your job is to say who is worth a message right now and what that
message should be.

What the evidence usually means:
- Saying they will pay later ("heta dannam", "Town ගියාම දාලා", "machine eken",
  "bank eken heta") is the single most common reason for non-payment. These
  people meant it. They needed to reach a bank and nobody reminded them. HOT.
- Asking something we never answered is the worst case: they are waiting on us. HOT.
- Having read our bank details and gone quiet is warmer than never having read
  them, because we know the message landed.
- Having given full birth details is real effort spent. Warm at least.
- Only a flat refusal is cold. Silence is not refusal.

You are given ONE person. Reply with a single JSON object, no markdown:
{"temp":"hot|warm|cold","why":"<max 12 words, English, for the operator>",
 "draft":"<the WhatsApp message to send, in the same language and register they used>"}

Rules for the draft — read these twice, the tone matters more than the content:

You are NOT collecting money. You are checking that someone who came to you
worried about their marriage, their job or their apala has everything they need.
That is the whole message.

NEVER:
- ask whether they have paid, in any wording: no "ගෙවීම් කටයුතු සිදුකලාද",
  no "did you make the payment", no "රිසිට් එක එවන්න" as a nudge
- mention the amount, the account, or the receipt unless they asked about it
- imply they are late, or that you are waiting on them
- use urgency, scarcity, or "just checking in" filler
- ask for anything already on file
- ask whether they CAN pay now, or when they will. "ඔබට දැන් ගෙවීම් කටයුතු සිදු
  කරන්න පුළුවන්ද?" is the same demand with a question mark on it. If they have
  already told you when they intend to pay, that is settled — do not reopen it.
- claim the report is ready, prepared, or waiting for them. Nothing is written
  until payment clears, and telling someone their report is done when it does
  not exist is worse than any amount of pushiness. You may say the astrologer is
  ready to BEGIN once they are.
- offer a phone call, unless they asked for one themselves.

INSTEAD, do one of these, whichever fits:
- Return to what they actually came for. If they wanted to know about a career
  change or a marriage, say the astrologer is ready to look at it for them.
- Ask, plainly and warmly, whether anything was unclear or whether they have a
  question. Leave the door open rather than pushing them through it.
- If THEY raised a difficulty (only a Bank of Ceylon nearby, no online banking,
  could not reach town), answer that difficulty as help — mention that a deposit
  at any branch works too, or that there is no rush. Help, not a reminder.
- If we owe them an answer, just answer it. Nothing else.

Length: one or two short sentences. At most one emoji. Never mention this is
automated. Match their language and register exactly — Sinhala for Sinhala,
Singlish for Singlish.

A good message leaves them feeling looked after and slightly more likely to
come back. A message that mentions money makes them feel chased, and someone
who meant to pay tomorrow now feels awkward about it.

- For cold, set draft to "".`;

/**
 * Ask the model to read one person's facts and say whether to chase them.
 *
 * One request per person on purpose. A shared request blends them together:
 * measured on real data, drafts quoted the wrong customer's words and asked for
 * details already on file.
 *
 * @param {Object} facts
 * @param {string} apiKey
 * @returns {Promise<Object|null>} { temp, why, draft }, or null if it failed
 */
async function classifyOne(facts, apiKey) {
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM,
    generationConfig: {
      temperature: 0.4,
      // Reasoning is billed against the same output budget, and it was
      // consuming it before the draft was finished — every reply came back as
      // truncated JSON. This is a small structured task with the facts already
      // laid out; it does not need to plan. Sinhala also runs about 2.3
      // characters per token, so a short draft is not a short response.
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
    },
  });

  try {
    const res = await model.generateContent(describe(facts));
    const raw = res.response.text().trim().replace(/^```(?:json)?|```$/g, '').trim();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      temp: ['hot', 'warm', 'cold'].includes(parsed.temp) ? parsed.temp : 'warm',
      why: String(parsed.why || '').slice(0, 120),
      draft: String(parsed.draft || '').slice(0, 900),
    };
  } catch (e) {
    // One failure must not empty the queue: the facts still stand, and an
    // unclassified row is more useful than a missing one.
    console.warn(`[FOLLOW-UP] Could not classify ${facts.orderId}:`, e.message);
    return null;
  }
}

/**
 * Classify a list, a few at a time so a full queue does not take a minute.
 *
 * @param {Array<Object>} list
 * @param {string} apiKey
 * @returns {Promise<Array<Object|null>>} aligned with the input order
 */
async function classifyAll(list, apiKey) {
  const out = new Array(list.length).fill(null);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < list.length; i = next++) {
      out[i] = await classifyOne(list[i], apiKey);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
  return out;
}

/** Hot first, then whoever we are about to lose. */
const TEMP_RANK = { hot: 0, warm: 1, cold: 2 };

/**
 * Build the queue for a client.
 *
 * @param {string} clientId
 * @returns {Promise<{items: Array<Object>, counts: Object, generatedAt: string}>}
 */
async function buildQueue(clientId) {
  const rows = await loadCandidates(clientId);
  const facts = rows.map(factsFor);

  // Only spend a model call where something has actually changed.
  const stale = [];
  for (const f of facts) {
    const key = `${clientId}:${f.orderId}:${f.minutesQuiet >= QUIET_MINUTES}:${f.lastFromThem.slice(0, 60)}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) f._judgement = hit.value;
    else stale.push({ f, key });
  }

  if (stale.length) {
    const apiKey = await getGeminiKey(clientId);
    const judged = await classifyAll(stale.map(s => s.f), apiKey);
    stale.forEach((s, n) => {
      const j = judged[n] || null;
      s.f._judgement = j;
      if (j) cache.set(s.key, { at: Date.now(), value: j });
    });
  }

  const items = facts.map((f) => {
    const j = f._judgement;
    delete f._judgement;
    return {
      ...f,
      temp: j?.temp || (f.theySpokeLast ? 'hot' : 'warm'),
      why: j?.why || (f.theySpokeLast ? 'They spoke last and we never replied' : 'Awaiting payment'),
      draft: j?.draft || '',
      classified: !!j,
    };
  });

  items.sort((a, b) =>
    (TEMP_RANK[a.temp] ?? 1) - (TEMP_RANK[b.temp] ?? 1) ||
    a.hoursLeft - b.hoursLeft);

  const counts = { total: items.length, hot: 0, warm: 0, cold: 0, due: 0, closingSoon: 0 };
  for (const i of items) {
    counts[i.temp] = (counts[i.temp] || 0) + 1;
    if (i.due) counts.due++;
    if (i.closingSoon) counts.closingSoon++;
  }

  return { items, counts, generatedAt: new Date().toISOString() };
}

module.exports = { buildQueue, WINDOW_HOURS, QUIET_MINUTES, CLOSING_SOON_HOURS };
