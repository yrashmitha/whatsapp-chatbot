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
const { formatLocal, windowClosesAt, timezoneFor, localToUtc } = require('./scheduledFollowUps');

/** WhatsApp's free-form reply window. */
const WINDOW_HOURS = 24;

/** Leave someone alone this long after their last message before chasing. */
const QUIET_MINUTES = 90;

/** Below this many hours left, it is the last realistic chance to reach them. */
const CLOSING_SOON_HOURS = 4;

/** How many candidates to classify at once. One call each, run in parallel. */
const CONCURRENCY = 4;

/**
 * Bumped whenever the instructions below change.
 *
 * A stored judgement is only reusable if it was made under the same rules. The
 * first time this was missed, a prompt change reached nobody: every fingerprint
 * still matched, so the whole queue kept serving answers from the old prompt.
 */
const JUDGEMENT_VERSION = 5;

/**
 * What a judgement depends on: the rules in force, what they last said, and
 * whether they are due.
 *
 * Not the hours left in the window — that changes continuously, and the drafts
 * lean on what the person said rather than on the clock, so including it would
 * pay to regenerate near-identical text every few minutes.
 *
 * @param {Object} f
 * @returns {string}
 */
function fingerprint(f, promptStamp = '') {
  const tail = (f.recent || []).map(m => `${m.who}:${String(m.text).slice(0, 60)}`).join('~');
  return `v${JUDGEMENT_VERSION}${promptStamp}|${f.due ? 'due' : 'quiet'}|${f.theySpokeLast ? 'ours' : 'theirs'}|${tail || f.lastFromThem.slice(0, 120)}`;
}

/**
 * The client's own follow-up instructions, if they have written any.
 *
 * The stamp goes into the fingerprint so that editing the instructions forces
 * every stored judgement to be made again — otherwise a change would reach
 * nobody, because the conversations themselves would not have moved.
 *
 * @param {string} clientId
 * @returns {Promise<{prompt: string|null, stamp: string}>}
 */
async function loadPromptConfig(clientId) {
  try {
    const cfg = await db.getPluginConfig(clientId, 'follow_up_queue');
    const prompt = (cfg?.prompt || '').trim();
    if (!prompt) return { prompt: null, stamp: '' };
    // Length plus a cheap checksum: enough to notice any edit, and short.
    let sum = 0;
    for (let i = 0; i < prompt.length; i++) sum = (sum * 31 + prompt.charCodeAt(i)) % 1e9;
    return { prompt, stamp: `-p${prompt.length}.${sum.toString(36)}` };
  } catch {
    return { prompt: null, stamp: '' };
  }
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
           AND m.sender_type = 'user')::int AS total_in,
       recent.lines AS recent_lines,
       fu.sent_at   AS followed_up_at,
       fu.angle     AS followed_up_angle,
       sch.send_at  AS scheduled_for
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
     -- The last few turns, both sides. A bare "ok" or "👍" is the most common
     -- last message there is and says nothing; what came before it usually does.
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object('who', t.sender_type, 'text', LEFT(t.message_text, 320))
                       ORDER BY t.id) AS lines
         FROM (SELECT id, sender_type, message_text FROM messages m
                WHERE m.phone_number = o.phone_number AND m.client_id = o.client_id
                  AND m.is_deleted IS NOT TRUE
                ORDER BY m.id DESC LIMIT 8) t
     ) recent ON TRUE

     -- Only follow-ups sent since they last spoke count as answered: an older
     -- one belongs to a conversation that has moved on.
     LEFT JOIN LATERAL (
       SELECT sent_at, angle FROM follow_up_sends f
        WHERE f.order_id = o.order_id AND f.client_id = o.client_id
          AND f.sent_at > c.last_customer_message_at
        ORDER BY f.sent_at DESC LIMIT 1
     ) fu ON TRUE
     LEFT JOIN LATERAL (
       SELECT send_at FROM scheduled_follow_ups s
        WHERE s.order_id = o.order_id AND s.client_id = o.client_id AND s.status = 'pending'
        ORDER BY s.send_at ASC LIMIT 1
     ) sch ON TRUE
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
    recent: Array.isArray(row.recent_lines) ? row.recent_lines : [],
    lastFromUs: (row.last_out_text || '').slice(0, 300),
    lastFromUsStatus: row.last_out_status || 'unknown',
    readOurLast,
    readAt: row.last_out_read_at || null,
    package: cf.package || cf.product_id || null,
    remarks: Array.isArray(row.remarks) ? row.remarks.map(r => r.text).slice(-3) : [],
    // Due once they have been quiet a while and nobody has chased since.
    due: minutesQuiet >= QUIET_MINUTES && Number(row.chased_since || 0) === 0 && !row.followed_up_at && !row.scheduled_for,
    closingSoon: hoursLeft <= CLOSING_SOON_HOURS,
    lastInAt: row.last_in_at || null,
    followedUpAt: row.followed_up_at || null,
    followedUpAngle: row.followed_up_angle || null,
    scheduledFor: row.scheduled_for || null,
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
    `  they ${f.readOurLast ? 'HAVE read' : `have NOT read (status: ${f.lastFromUsStatus})`} our last message`,
    f.theySpokeLast
      ? '  THEY SPOKE LAST and we never replied'
      : `  we have sent ${f.chasedSince} message(s) since they last spoke`,
  ];
  if (f.recent.length) {
    lines.push('  how the conversation ended, oldest first:');
    for (const m of f.recent) {
      lines.push(`    ${m.who === 'user' ? 'THEM' : 'US  '}: ${String(m.text).replace(/\s+/g, ' ').slice(0, 200)}`);
    }
    lines.push('  Read all of it. The last line is often just an acknowledgement;');
    lines.push('  what they said before it is usually what matters.');
  }
  if (f.remarks.length) lines.push(`  operator notes: ${f.remarks.join(' | ')}`);
  if (f.nowLocal) {
    lines.push(`  the time where they are is ${f.nowLocal}`);
    lines.push(`  we can send a free message until ${f.windowClosesLocal}, and not after`);
  }
  return lines.join('\n');
}

const DEFAULT_SYSTEM = `You are a behavioural marketer working for a Sri Lankan astrology
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
question to answer, some need permission to take their time. You decide which.

But their worry is theirs, not a lever. NEVER repeat their difficulty back to
them. "ඔබට රස්සාවේ ස්ට්‍රෙස් එක වැඩියි කියලා තිබුණා" — you said your job stress
is high — was told to you once, in confidence. Quoted back by a business it
reads as pressure, and as a business that noticed where it hurts. It is the
fastest way to make someone feel handled rather than helped.

Name the SUBJECT if it helps — the career reading, the marriage reading, the
chart. Never name their FEELINGS about it, and never put a request in the same
message as either. "You are stressed, so send me your details" is the shape to
avoid, however warmly it is phrased.

Give rather than ask. Offer help, offer an answer, offer time. Where you do ask
something, make it small and easy to answer, and let it stand on its own.

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
- Do not quote their situation back at them, and do not pair any reference to
  what they came for with a request.
- Do not create urgency. They set the pace.
Everything else is yours to judge, including whether to mention money at all.

Length: one or two sentences, WhatsApp register. At most one emoji. Match their
language exactly — Sinhala for Sinhala, Singlish for Singlish, English for
English. Never reveal that this is automated.

WHEN TO SEND IT
You also choose the moment. Someone who said they would pay tomorrow should hear
from us tomorrow morning, not in an hour — a reminder that arrives before they
could possibly have acted is just nagging. Someone who said "දවල්" should hear
from us early afternoon. Someone who simply went quiet mid-conversation can hear
back sooner.

Give the time as "YYYY-MM-DD HH:MM" on their local clock, which is stated in the
facts. It must be at least thirty minutes from now and comfortably before the
window shuts — a message that arrives after it closes is never delivered at all,
so when in doubt go earlier. Prefer waking hours: nothing before 07:30 or after
21:00 unless they named a time themselves.

TONE
This is a friendly, helpful note from a business that is holding their place —
the sort a good shop assistant sends. Not a sales push, not a collection notice.
They should finish reading it feeling looked after.

You are given ONE person. Reply with a single JSON object, no markdown:
{"temp":"hot|warm|cold","why":"<max 12 words, English, what is going on for them>",
 "draft":"<the message>","angle":"<max 6 words, English, the lever you chose>",
 "send_at":"YYYY-MM-DD HH:MM","when_why":"<max 8 words, English, why that moment>"}

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
async function classifyOne(facts, apiKey, systemInstruction) {
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: systemInstruction || DEFAULT_SYSTEM,
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
      sendAt: String(parsed.send_at || '').slice(0, 20),
      whenWhy: String(parsed.when_why || '').slice(0, 80),
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
async function classifyAll(list, apiKey, systemInstruction) {
  const out = new Array(list.length).fill(null);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < list.length; i = next++) {
      out[i] = await classifyOne(list[i], apiKey, systemInstruction);
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
  const cfg = await loadPromptConfig(clientId);
  const rows = await loadCandidates(clientId);
  const tz = await timezoneFor(clientId);
  const facts = rows.map(factsFor);
  for (const f of facts) {
    const closes = windowClosesAt(f.lastInAt);
    f.nowLocal = formatLocal(new Date(), tz);
    f.windowClosesLocal = closes ? formatLocal(closes, tz) : 'unknown';
    f.windowClosesAt = closes ? closes.toISOString() : null;
    f.timezone = tz;
  }

  // Only spend a model call where the conversation has actually moved.
  const saved = new Map();
  if (facts.length) {
    const { rows } = await db.pgQuery(
      `SELECT order_id, fingerprint, temp, why, angle, draft, send_at, when_why
         FROM follow_up_judgements
        WHERE client_id = $1 AND order_id = ANY($2)`,
      [clientId, facts.map(f => f.orderId)]);
    rows.forEach(r => saved.set(r.order_id, r));
  }

  const stale = [];
  for (const f of facts) {
    const fp = fingerprint(f, cfg.stamp);
    const hit = saved.get(f.orderId);
    if (hit && hit.fingerprint === fp) {
      f._judgement = {
        temp: hit.temp, why: hit.why, angle: hit.angle, draft: hit.draft,
        sendAt: hit.send_at || '', whenWhy: hit.when_why || '',
      };
    } else {
      stale.push({ f, fp });
    }
  }

  if (stale.length) {
    const apiKey = await getGeminiKey(clientId);
    const judged = await classifyAll(stale.map(s => s.f), apiKey, cfg.prompt);
    await Promise.all(stale.map(async (s, n) => {
      const j = judged[n] || null;
      s.f._judgement = j;
      if (!j) return;
      // A judgement that cannot be stored is still usable now, so a write
      // failure must not lose the call that was already paid for.
      await db.pgQuery(
        `INSERT INTO follow_up_judgements
           (client_id, order_id, fingerprint, temp, why, angle, draft, send_at, when_why, created_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (client_id, order_id) DO UPDATE
            SET fingerprint = EXCLUDED.fingerprint, temp = EXCLUDED.temp, why = EXCLUDED.why,
                angle = EXCLUDED.angle, draft = EXCLUDED.draft, send_at = EXCLUDED.send_at,
                when_why = EXCLUDED.when_why, created_at = NOW()`,
        [clientId, s.f.orderId, s.fp, j.temp, j.why, j.angle || '', j.draft,
         j.sendAt || '', j.whenWhy || '']
      ).catch(e => console.warn(`[FOLLOW-UP] Could not store judgement for ${s.f.orderId}:`, e.message));
    }));
    console.log(`[FOLLOW-UP] ${clientId}: ${facts.length} in queue, ${stale.length} needed judging`);
  }

  const items = facts.map((f) => {
    const j = f._judgement;
    delete f._judgement;

    // A suggested time is only useful if it is still sendable. One stored
    // yesterday may now be in the past, and a window that had twenty hours left
    // has fewer now, so it is re-checked on every read rather than trusted.
    const closes = f.windowClosesAt ? new Date(f.windowClosesAt) : null;
    const earliest = Date.now() + 15 * 60_000;
    const latest = closes ? closes.getTime() - 15 * 60_000 : Infinity;
    const usable = (at) => at && at.getTime() > earliest && at.getTime() < latest;

    let suggested = '';
    let whenWhy = j?.whenWhy || '';
    if (j?.sendAt && usable(localToUtc(j.sendAt, tz))) {
      suggested = j.sendAt;
    } else if (latest > earliest) {
      // Their own suggestion no longer fits, but there is still room. Prefer
      // the next morning when the window reaches it — someone who said they
      // would pay tomorrow should hear from us tomorrow, not tonight — and
      // otherwise an hour from now.
      const morning = new Date();
      morning.setUTCHours(morning.getUTCHours() + 24);
      const nextMorningLocal = `${formatLocal(morning, tz).slice(0, 10)} 09:00`;
      const nextMorning = localToUtc(nextMorningLocal, tz);
      if (usable(nextMorning)) {
        suggested = nextMorningLocal;
        whenWhy = whenWhy || 'next morning, inside their window';
      } else {
        // An hour from now where there is room, otherwise the latest moment
        // that still works. A tight window is exactly when a suggestion is most
        // useful, so it should not be the case that produces an empty box.
        const hour = Date.now() + 60 * 60_000;
        const at = new Date(Math.min(hour, latest - 5 * 60_000));
        if (usable(at)) {
          suggested = formatLocal(at, tz);
          whenWhy = whenWhy || (hour > latest ? 'last moment before their window shuts' : 'about an hour from now');
        }
      }
    }
    f.suggestedSendAt = suggested;
    f.suggestedWhenWhy = suggested ? whenWhy : '';
    f.windowClosesLocalOut = f.windowClosesLocal;
    return {
      ...f,
      temp: j?.temp || (f.theySpokeLast ? 'hot' : 'warm'),
      why: j?.why || (f.theySpokeLast ? 'They spoke last and we never replied' : 'Awaiting payment'),
      angle: j?.angle || '',
      draft: j?.draft || '',
      followedUpAt: f.followedUpAt,
      followedUpAngle: f.followedUpAngle,
      scheduledFor: f.scheduledFor,
      handled: !!(f.followedUpAt || f.scheduledFor),
      suggestedSendAt: f.suggestedSendAt || '',
      whenWhy: f.suggestedWhenWhy || '',
      windowClosesLocal: f.windowClosesLocalOut || '',
      timezone: f.timezone || '',
      classified: !!j,
    };
  });

  // Work still to do first; anyone already contacted or queued sinks.
  const handled = (i) => (i.followedUpAt || i.scheduledFor ? 1 : 0);
  items.sort((a, b) =>
    handled(a) - handled(b) ||
    (TEMP_RANK[a.temp] ?? 1) - (TEMP_RANK[b.temp] ?? 1) ||
    a.hoursLeft - b.hoursLeft);

  const counts = { total: items.length, hot: 0, warm: 0, cold: 0, due: 0, closingSoon: 0, handled: 0, waiting: 0 };
  for (const i of items) {
    if (i.followedUpAt || i.scheduledFor) { counts.handled++; continue; }
    counts.waiting++;
    counts[i.temp] = (counts[i.temp] || 0) + 1;
    if (i.due) counts.due++;
    if (i.closingSoon) counts.closingSoon++;
  }

  return { items, counts, generatedAt: new Date().toISOString() };
}

module.exports = { buildQueue, DEFAULT_SYSTEM, WINDOW_HOURS, QUIET_MINUTES, CLOSING_SOON_HOURS };
