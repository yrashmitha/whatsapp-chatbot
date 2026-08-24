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

/**
 * What a judgement depends on: what they last said, and whether they are due.
 *
 * Not the hours left in the window — that changes continuously, and the drafts
 * lean on what the person said rather than on the clock, so including it would
 * pay to regenerate near-identical text every few minutes.
 *
 * @param {Object} f
 * @returns {string}
 */
function fingerprint(f) {
  return `${f.due ? 'due' : 'quiet'}|${f.theySpokeLast ? 'ours' : 'theirs'}|${f.lastFromThem.slice(0, 120)}`;
}

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

const SYSTEM = `You are a behavioural marketer working for a Sri Lankan astrology
business, and you are unusually good at understanding why someone who wanted
something stopped short of getting it.

Everyone you are shown asked for a reading, gave their birth details, saw the
price, and then went quiet without paying. Almost none of them refused. Read the
evidence and work out what is actually going on for THIS person, then write the
one message most likely to make them reply.

YOUR GOAL IS A REPLY. Not a payment. A reply reopens the conversation and puts a
person back in front of them, and that is where the sale happens. A message that
gets read and ignored has failed even if it was polite. Ask yourself: would this
person feel a pull to answer, or is it easy to leave?

What the evidence usually means:
- They said they would pay later ("heta dannam", "Town ගියාම දාලා", "machine
  eken"): they meant it. Life intervened. They are not avoiding you.
- They read the message and went quiet: it landed. Something after it stopped them.
- They never read it: nothing stopped them. They may not know it arrived.
- They asked something and we never answered: they are waiting on us, and the
  silence has probably been read as indifference.
- They typed out their full birth details: that is real effort, freely given.
  Nobody does that unless they want to know.

Think about what actually moves someone in this situation. They came with a
worry that has not gone away — a marriage that may not happen, a job that is
crushing them, an apala they are frightened of. That worry is still live. The
payment is a chore standing between them and an answer. Different people need
different things: some need the door held open, some need one small easy
question to answer, some need to be reminded why they wrote in the first place,
some need permission to take their time. You decide which, per person.

You may be persuasive. You may not be dishonest:
- Do not claim the report is written, ready, or waiting. Nothing is made until
  they pay, and someone who is told their report is ready and then finds it is
  not will never trust you again.
- Do not state anything about their chart. Nobody has read it. Inventing a
  finding to hook them is fraud, and it is also the easiest thing to get caught doing.
- Do not invent a deadline, a price rise, a queue position, or a limited slot
  that does not exist.
- Do not offer a phone call unless they asked for one.
- Do not ask for anything already on file.
Everything else is yours to judge, including whether to mention money at all.

Length: one or two sentences, WhatsApp register. At most one emoji. Match their
language exactly — Sinhala for Sinhala, Singlish for Singlish, English for
English. Never reveal that this is automated.

You are given ONE person. Reply with a single JSON object, no markdown:
{"temp":"hot|warm|cold","why":"<max 12 words, English, what is going on for them>",
 "draft":"<the message>","angle":"<max 6 words, English, the lever you chose>"}

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
      angle: String(parsed.angle || '').slice(0, 60),
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

  // Only spend a model call where the conversation has actually moved.
  const saved = new Map();
  if (facts.length) {
    const { rows } = await db.pgQuery(
      `SELECT order_id, fingerprint, temp, why, angle, draft
         FROM follow_up_judgements
        WHERE client_id = $1 AND order_id = ANY($2)`,
      [clientId, facts.map(f => f.orderId)]);
    rows.forEach(r => saved.set(r.order_id, r));
  }

  const stale = [];
  for (const f of facts) {
    const fp = fingerprint(f);
    const hit = saved.get(f.orderId);
    if (hit && hit.fingerprint === fp) {
      f._judgement = { temp: hit.temp, why: hit.why, angle: hit.angle, draft: hit.draft };
    } else {
      stale.push({ f, fp });
    }
  }

  if (stale.length) {
    const apiKey = await getGeminiKey(clientId);
    const judged = await classifyAll(stale.map(s => s.f), apiKey);
    await Promise.all(stale.map(async (s, n) => {
      const j = judged[n] || null;
      s.f._judgement = j;
      if (!j) return;
      // A judgement that cannot be stored is still usable now, so a write
      // failure must not lose the call that was already paid for.
      await db.pgQuery(
        `INSERT INTO follow_up_judgements (client_id, order_id, fingerprint, temp, why, angle, draft, created_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (client_id, order_id) DO UPDATE
            SET fingerprint = EXCLUDED.fingerprint, temp = EXCLUDED.temp, why = EXCLUDED.why,
                angle = EXCLUDED.angle, draft = EXCLUDED.draft, created_at = NOW()`,
        [clientId, s.f.orderId, s.fp, j.temp, j.why, j.angle || '', j.draft]
      ).catch(e => console.warn(`[FOLLOW-UP] Could not store judgement for ${s.f.orderId}:`, e.message));
    }));
    console.log(`[FOLLOW-UP] ${clientId}: ${facts.length} in queue, ${stale.length} needed judging`);
  }

  const items = facts.map((f) => {
    const j = f._judgement;
    delete f._judgement;
    return {
      ...f,
      temp: j?.temp || (f.theySpokeLast ? 'hot' : 'warm'),
      why: j?.why || (f.theySpokeLast ? 'They spoke last and we never replied' : 'Awaiting payment'),
      angle: j?.angle || '',
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
