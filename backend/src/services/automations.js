/**
 * @module services/automations
 * @description Automatic messages, by rules the owner builds. No AI.
 *
 * A rule is: "between MIN and MAX hours after a customer's last message, if
 * all of these conditions hold, send this fixed text". Each customer is timed
 * from their own last message, so someone who wrote at 9 PM and someone who
 * wrote at 8 AM each get it at the same distance from their own message, not
 * at one clock time for everybody.
 *
 * Everything stays inside WhatsApp's 24 hour customer service window: a free
 * text message is only delivered within 24 hours of the customer's last
 * message, so MAX is capped below that, and the window is checked again at the
 * moment of sending.
 *
 * Guards that every rule has, whatever its conditions:
 *  - once per silence: a rule sends at most once after each customer message
 *    (keyed on that message's time, so a new message lets it fire again later);
 *  - a gap: no automatic message to a customer within `gap_hours` of the last
 *    automatic message to them, from any rule;
 *  - quiet hours: nothing is sent in them; a customer still in range at the end
 *    of quiet hours gets it then;
 *  - customers marked not interested or wrong number are never messaged.
 *
 * Conditions are a fixed vocabulary (FIELDS below). Every value is passed as a
 * query parameter and every field and operator is checked against the list,
 * so nothing a user types is ever placed in the SQL itself.
 */

'use strict';

const db = require('../db');
const clientRouter = require('./clientRouter');
const { sendWhatsAppMessage } = require('./whatsapp');
const { PAID_STATUSES, VALUE_SQL } = require('./salesCredit');
const { timezoneFor, formatLocal } = require('./scheduledFollowUps');

/** Never later than this after the customer's last message (WhatsApp allows 24). */
const MAX_HOURS_CAP = 23.5;
/** At most this many sends per rule per run, so one run cannot flood the number. */
const PER_RUN_LIMIT = 200;
/** Pause between sends, to stay well clear of WhatsApp's rate limits. */
const SEND_GAP_MS = 1000;
/** How often the rules are evaluated. */
const RUN_EVERY_MS = 15 * 60 * 1000;

/** The latest message in the chat and who sent it. */
const LAST_SENDER_SQL = `(SELECT m.sender_type FROM messages m
   WHERE m.phone_number = cu.phone_number AND m.client_id = cu.client_id
   ORDER BY m.created_at DESC, m.id DESC LIMIT 1)`;
const LATEST_ORDER = (col) => `(SELECT ${col} FROM orders o
   WHERE o.phone_number = cu.phone_number AND o.client_id = cu.client_id
   ORDER BY o.created_at DESC LIMIT 1)`;
const SETTINGS = (col) => `(SELECT cs.${col} FROM customer_settings cs
   WHERE cs.phone_number = cu.phone_number AND cs.client_id = cu.client_id)`;
const LEAD_STATUSES = ['new', 'interested', 'thinking', 'promised_payment', 'not_interested', 'wrong_number', 'bought'];

/**
 * The conditions a rule can use. Each turns { op, value } into SQL, adding its
 * values through `p` (which returns a $n placeholder). Unknown fields or
 * operators throw, so a bad rule is refused rather than half applied.
 */
const FIELDS = {
  // Who wrote last in the chat: 'us' (bot or a person) or 'customer'.
  last_from: {
    ops: ['is'],
    sql: (op, v) => {
      if (v === 'us') return `${LAST_SENDER_SQL} = 'bot'`;
      if (v === 'customer') return `${LAST_SENDER_SQL} = 'user'`;
      throw new Error('last_from must be us or customer');
    },
  },
  // Their orders, any time.
  orders: {
    ops: ['is'],
    sql: (op, v, p) => {
      const exists = (cond) => `EXISTS (SELECT 1 FROM orders o WHERE o.phone_number = cu.phone_number AND o.client_id = cu.client_id${cond})`;
      if (v === 'none') return `NOT ${exists('')}`;
      if (v === 'any') return exists('');
      if (v === 'pending') return exists(` AND o.status = 'pending'`);
      if (v === 'no_pending') return `NOT ${exists(` AND o.status = 'pending'`)}`;
      if (v === 'paid') return exists(` AND o.status = ANY(${p(PAID_STATUSES)})`);
      if (v === 'never_paid') return `NOT ${exists(` AND o.status = ANY(${p(PAID_STATUSES)})`)}`;
      throw new Error('orders must be none, any, pending, no_pending, paid or never_paid');
    },
  },
  // Paid (or delivered) within the last N days.
  paid_within_days: {
    ops: ['lte'],
    sql: (op, v, p) => {
      const n = Number(v);
      if (!(n > 0 && n <= 365)) throw new Error('paid_within_days must be 1 to 365');
      return `EXISTS (SELECT 1 FROM orders o WHERE o.phone_number = cu.phone_number AND o.client_id = cu.client_id
                 AND o.status = ANY(${p(PAID_STATUSES)})
                 AND COALESCE(o.credited_at, o.created_at) >= NOW() - (${p(String(n))} || ' days')::interval)`;
    },
  },
  // Value of their latest order, in rupees (price, else the paid amount, else items).
  latest_order_value: {
    ops: ['eq', 'gte', 'lte'],
    sql: (op, v, p) => {
      const n = Number(v);
      if (!(n >= 0)) throw new Error('latest_order_value must be a number');
      const cmp = { eq: '=', gte: '>=', lte: '<=' }[op];
      return `${LATEST_ORDER(`ROUND(${VALUE_SQL})`)} ${cmp} ${p(n)}`;
    },
  },
  // Lead status on the Leads page; 'new' means nobody set one.
  lead_status: {
    ops: ['is', 'is_not'],
    sql: (op, v, p) => {
      const list = (Array.isArray(v) ? v : [v]).filter(x => LEAD_STATUSES.includes(x));
      if (!list.length) throw new Error('lead_status needs at least one status');
      const expr = `COALESCE(${SETTINGS('lead_status')}, 'new')`;
      return op === 'is' ? `${expr} = ANY(${p(list)})` : `NOT (${expr} = ANY(${p(list)}))`;
    },
  },
  // Came in from a Meta ad.
  from_ad: {
    ops: ['is'],
    sql: (op, v) => (v === true || v === 'yes' ? 'cu.first_ad_id IS NOT NULL' : 'cu.first_ad_id IS NULL'),
  },
  // The bot is on or off in this chat.
  ai: {
    ops: ['is'],
    sql: (op, v) => (v === 'off'
      ? `COALESCE(${SETTINGS('ai_enabled')}, TRUE) = FALSE`
      : `COALESCE(${SETTINGS('ai_enabled')}, TRUE) = TRUE`),
  },
  // Days since their very first message to us.
  first_contact_days: {
    ops: ['lte', 'gte'],
    sql: (op, v, p) => {
      const n = Number(v);
      if (!(n >= 0 && n <= 3650)) throw new Error('first_contact_days must be 0 to 3650');
      const first = `(SELECT MIN(m.created_at) FROM messages m WHERE m.phone_number = cu.phone_number AND m.client_id = cu.client_id)`;
      return op === 'lte'
        ? `${first} >= NOW() - (${p(String(n))} || ' days')::interval`
        : `${first} <= NOW() - (${p(String(n))} || ' days')::interval`;
    },
  },
};

/**
 * Check a rule and clean it up, or throw a message meant for the owner.
 *
 * @param {Object} r
 * @returns {Object}
 */
function validateRule(r) {
  const name = String(r?.name || '').trim();
  if (!name) throw Object.assign(new Error('Give the rule a name'), { statusCode: 400 });
  const message = String(r?.message || '').trim();
  if (!message) throw Object.assign(new Error('Write the message to send'), { statusCode: 400 });
  if (message.length > 4000) throw Object.assign(new Error('The message is too long for WhatsApp'), { statusCode: 400 });
  const minH = Number(r?.min_hours), maxH = Number(r?.max_hours);
  if (!(minH >= 0) || !(maxH > minH)) throw Object.assign(new Error('The "to" hours must be more than the "from" hours'), { statusCode: 400 });
  if (maxH > MAX_HOURS_CAP) throw Object.assign(new Error(`WhatsApp only delivers within 24 hours of the customer's last message, so "to" can be at most ${MAX_HOURS_CAP} hours`), { statusCode: 400 });
  const gap = r?.gap_hours == null ? 24 : Number(r.gap_hours);
  if (!(gap >= 0 && gap <= 720)) throw Object.assign(new Error('The gap must be 0 to 720 hours'), { statusCode: 400 });
  const qs = r?.quiet_start == null ? 22 : Number(r.quiet_start);
  const qe = r?.quiet_end == null ? 8 : Number(r.quiet_end);
  if (![qs, qe].every(h => Number.isInteger(h) && h >= 0 && h <= 23)) throw Object.assign(new Error('Quiet hours must be whole hours 0 to 23'), { statusCode: 400 });
  const conditions = Array.isArray(r?.conditions) ? r.conditions : [];
  // Try building the SQL once so a bad condition is refused now, not at 3 AM.
  buildWhere(conditions, []);
  return { name, message, min_hours: minH, max_hours: maxH, gap_hours: gap, quiet_start: qs, quiet_end: qe, conditions,
           enabled: !!r?.enabled, once_per_customer: !!r?.once_per_customer };
}

/**
 * The SQL for a rule's conditions, all of which must hold.
 *
 * @param {Array<{field:string, op:string, value:*}>} conditions
 * @param {Array} params - filled with the values
 * @returns {string}
 */
function buildWhere(conditions, params) {
  const p = (v) => { params.push(v); return `$${params.length}`; };
  return conditions.map((c, i) => {
    const f = FIELDS[c?.field];
    if (!f) throw Object.assign(new Error(`Condition ${i + 1}: unknown field`), { statusCode: 400 });
    if (!f.ops.includes(c.op)) throw Object.assign(new Error(`Condition ${i + 1}: that comparison is not allowed for this field`), { statusCode: 400 });
    try { return `(${f.sql(c.op, c.value, p)})`; }
    catch (e) { throw Object.assign(new Error(`Condition ${i + 1}: ${e.message}`), { statusCode: 400 }); }
  }).join(' AND ');
}

/** The hour now on the client's clock. */
function hourIn(tz) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date())) % 24;
}

/** Whether `hour` falls in quiet hours that may wrap midnight (22 to 8). */
function isQuiet(hour, start, end) {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/**
 * Who a rule would message right now, before quiet hours.
 *
 * @param {string} clientId
 * @param {Object} rule - with id (or null for an unsaved preview)
 * @param {number} [limit]
 * @returns {Promise<Array<{phone_number:string, name:string|null, last_customer_message_at:Date}>>}
 */
async function candidates(clientId, rule, limit = PER_RUN_LIMIT) {
  const params = [clientId, String(rule.min_hours), String(Math.min(rule.max_hours, MAX_HOURS_CAP)), String(rule.gap_hours)];
  const extra = buildWhere(rule.conditions || [], params);
  params.push(rule.id || 0); const ridIdx = params.length;
  params.push(limit); const limIdx = params.length;
  const sql = `
    SELECT cu.phone_number, cu.name, cu.last_customer_message_at
      FROM customers cu
     WHERE cu.client_id = $1
       AND cu.last_customer_message_at IS NOT NULL
       AND cu.last_customer_message_at <= NOW() - ($2 || ' hours')::interval
       AND cu.last_customer_message_at >= NOW() - ($3 || ' hours')::interval
       AND COALESCE(${SETTINGS('lead_status')}, 'new') NOT IN ('not_interested', 'wrong_number')
       -- once per silence: not already done for this customer message
       AND NOT EXISTS (SELECT 1 FROM auto_rule_sends s
                        WHERE s.rule_id = $${ridIdx} AND s.phone_number = cu.phone_number
                          AND s.client_id = cu.client_id AND s.trigger_at = cu.last_customer_message_at)
       -- once ever, when the rule asks for it (an invite, a welcome)
       ${rule.once_per_customer ? `AND NOT EXISTS (SELECT 1 FROM auto_rule_sends s
                        WHERE s.rule_id = $${ridIdx} AND s.phone_number = cu.phone_number
                          AND s.client_id = cu.client_id AND s.status = 'sent')` : ''}
       -- the gap: no automatic message to them recently, from any rule
       AND NOT EXISTS (SELECT 1 FROM auto_rule_sends s
                        WHERE s.client_id = cu.client_id AND s.phone_number = cu.phone_number
                          AND s.status = 'sent' AND s.sent_at > NOW() - ($4 || ' hours')::interval)
       ${extra ? `AND ${extra}` : ''}
     ORDER BY cu.last_customer_message_at ASC
     LIMIT $${limIdx}`;
  const { rows } = await db.pgQuery(sql, params);
  return rows;
}

/** The text with {name} filled in, or taken out tidily when there is no name. */
function fillText(text, name) {
  const n = String(name || '').trim();
  return n ? text.split('{name}').join(n)
    : text.replace(/\s*\{name\}\s*/g, ' ').replace(/ +([,.!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * Run one rule now: send to everyone it matches, unless it is quiet hours.
 *
 * @param {Object} rule - a row of auto_rules
 * @param {{ sleep?: (ms:number)=>Promise<void> }} [opts]
 * @returns {Promise<{sent:number, failed:number, quiet:boolean}>}
 */
async function runRule(rule, opts = {}) {
  const sleep = opts.sleep || ((ms) => new Promise(r => setTimeout(r, ms)));
  const tz = await timezoneFor(rule.client_id);
  if (isQuiet(hourIn(tz), rule.quiet_start, rule.quiet_end)) return { sent: 0, failed: 0, quiet: true };
  const list = await candidates(rule.client_id, rule);
  if (!list.length) return { sent: 0, failed: 0, quiet: false };
  const client = await clientRouter.getClientById(rule.client_id);
  let sent = 0, failed = 0;
  for (const c of list) {
    // Claim first: the unique key stops a second run, or a second server,
    // from sending the same message twice.
    const claim = await db.pgQuery(
      `INSERT INTO auto_rule_sends (rule_id, client_id, phone_number, trigger_at, status)
       VALUES ($1,$2,$3,$4,'sending') ON CONFLICT DO NOTHING RETURNING id`,
      [rule.id, rule.client_id, c.phone_number, c.last_customer_message_at]);
    if (!claim.rows.length) continue;
    const sendId = claim.rows[0].id;
    try {
      // Checked again at the moment of sending: still inside 24 hours, and the
      // customer has not written since this run picked them.
      const now = await db.pgQuery('SELECT last_customer_message_at FROM customers WHERE phone_number=$1 AND client_id=$2',
        [c.phone_number, rule.client_id]);
      const last = now.rows[0]?.last_customer_message_at;
      if (!last || new Date(last).getTime() !== new Date(c.last_customer_message_at).getTime()) {
        await db.pgQuery(`UPDATE auto_rule_sends SET status='skipped', reason='customer wrote again' WHERE id=$1`, [sendId]);
        continue;
      }
      if (Date.now() > new Date(last).getTime() + 24 * 36e5 - 5 * 60e3) {
        await db.pgQuery(`UPDATE auto_rule_sends SET status='skipped', reason='24 hour window closed' WHERE id=$1`, [sendId]);
        continue;
      }
      const text = fillText(rule.message, c.name);
      const wamid = await sendWhatsAppMessage(c.phone_number, text, client);
      if (!wamid) throw new Error('WhatsApp did not accept the message');
      await db.insertMessage(c.phone_number, text, 'bot', null, rule.client_id, null, null, wamid);
      await db.pgQuery(`UPDATE auto_rule_sends SET status='sent', sent_at=NOW(), wamid=$2 WHERE id=$1`, [sendId, wamid]);
      sent++;
    } catch (e) {
      failed++;
      await db.pgQuery(`UPDATE auto_rule_sends SET status='failed', reason=$2 WHERE id=$1`,
        [sendId, String(e.message || e).slice(0, 200)]).catch(() => {});
    }
    if (SEND_GAP_MS) await sleep(SEND_GAP_MS);
  }
  console.log(`[AUTO] rule ${rule.id} "${rule.name}" (${rule.client_id}): ${sent} sent, ${failed} failed`);
  return { sent, failed, quiet: false };
}

let running = false;
let lastRun = 0;
/**
 * Called every minute by the worker; runs all enabled rules every 15 minutes.
 * A run that is still going is never started twice.
 */
async function tick() {
  if (running || Date.now() - lastRun < RUN_EVERY_MS) return;
  running = true; lastRun = Date.now();
  try {
    const { rows } = await db.pgQuery('SELECT * FROM auto_rules WHERE enabled = TRUE ORDER BY id');
    for (const rule of rows) {
      try { await runRule(rule); }
      catch (e) { console.error(`[AUTO] rule ${rule.id} failed:`, e.message); }
    }
  } catch (e) {
    if (e.code !== '42P01') console.error('[AUTO] run failed:', e.message); // table not there yet: nothing to do
  } finally { running = false; }
}

/**
 * Per rule, for the last `days`: sent, failed, skipped, and how many of those
 * it was sent to wrote back, or paid, within 48 hours.
 */
async function stats(clientId, days = 7) {
  const { rows } = await db.pgQuery(`
    SELECT s.rule_id,
           COUNT(*) FILTER (WHERE s.status='sent')::int    AS sent,
           COUNT(*) FILTER (WHERE s.status='failed')::int  AS failed,
           COUNT(*) FILTER (WHERE s.status='skipped')::int AS skipped,
           COUNT(*) FILTER (WHERE s.status='sent' AND EXISTS (
             SELECT 1 FROM messages m WHERE m.phone_number=s.phone_number AND m.client_id=s.client_id
               AND m.sender_type='user' AND m.created_at > s.sent_at AND m.created_at <= s.sent_at + INTERVAL '48 hours'))::int AS replied,
           COUNT(*) FILTER (WHERE s.status='sent' AND EXISTS (
             SELECT 1 FROM orders o WHERE o.phone_number=s.phone_number AND o.client_id=s.client_id
               AND o.status = ANY($3) AND o.credited_at > s.sent_at AND o.credited_at <= s.sent_at + INTERVAL '48 hours'))::int AS paid
      FROM auto_rule_sends s
     WHERE s.client_id=$1 AND s.created_at > NOW() - ($2 || ' days')::interval
     GROUP BY s.rule_id`, [clientId, String(days), PAID_STATUSES]);
  return Object.fromEntries(rows.map(r => [r.rule_id, r]));
}

module.exports = {
  FIELDS, LEAD_STATUSES, MAX_HOURS_CAP, validateRule, buildWhere, candidates, runRule, tick, stats,
  fillText, isQuiet, hourIn, formatLocal, timezoneFor,
};
