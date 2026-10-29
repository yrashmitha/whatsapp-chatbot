/**
 * @module controllers/leads.controller
 * @description Lead quality and the call log, kept per chat (client + phone) so
 * a lead with no order can be tracked too.
 *
 * Status lives on customer_settings, calls in lead_call_log. The date of the
 * promised call-back is copied onto customer_settings.next_call_at whenever a
 * call is logged, so the tracker can filter and sort on it without a join.
 */

'use strict';

const db              = require('../db');
const resolveClientId = require('../middleware/resolveClientId');
const { timezoneFor } = require('../services/scheduledFollowUps');

/** null in the database means New: nobody has judged the lead yet. */
const LEAD_STATUSES = ['interested', 'thinking', 'promised_payment', 'not_interested', 'wrong_number', 'bought'];
const CALL_OUTCOMES = ['answered', 'no_answer', 'busy', 'switched_off', 'not_reachable', 'call_back', 'dialed', 'note'];

/** The calendar day it is now on a clock in `timeZone` ("YYYY-MM-DD"). */
function todayLocal(timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** A real calendar date in YYYY-MM-DD, or null. */
function cleanDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

/** Whether this chat belongs to the client. Stops a :phone from another tenant. */
async function chatExists(clientId, phone) {
  const r = await db.pgQuery(
    'SELECT 1 FROM customers WHERE client_id=$1 AND phone_number=$2', [clientId, phone]);
  return r.rows.length > 0;
}

/**
 * GET /api/leads - the tracker list, filterable and searchable.
 *
 * Query: status (new | a status), callback (today | overdue | upcoming | none),
 * outcome, search (name, phone or a call note), page, limit.
 */
async function listLeads(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 30);
  const { status, callback, outcome } = req.query;
  const search = (req.query.search || '').trim();
  try {
    const params = [clientId];
    const conds  = ['cu.client_id=$1'];
    const add = (v) => { params.push(v); return `$${params.length}`; };

    if (status === 'new') conds.push('cs.lead_status IS NULL');
    else if (LEAD_STATUSES.includes(status)) conds.push(`cs.lead_status=${add(status)}`);

    if (callback) {
      const today = add(todayLocal(await timezoneFor(clientId)));
      if (callback === 'today')         conds.push(`cs.next_call_at = ${today}::date`);
      else if (callback === 'overdue')  conds.push(`cs.next_call_at < ${today}::date`);
      else if (callback === 'upcoming') conds.push(`cs.next_call_at > ${today}::date`);
      else if (callback === 'none')     conds.push('cs.next_call_at IS NULL');
    }
    if (CALL_OUTCOMES.includes(outcome)) conds.push(`lc.outcome=${add(outcome)}`);

    // A date range on either the promised call-back day or the day of the last
    // call. Days are the client's own, so a call at 11pm counts for that evening.
    const from = cleanDate(req.query.date_from);
    const to   = cleanDate(req.query.date_to);
    if (from || to) {
      const col = req.query.date_field === 'called'
        ? `(lc.created_at AT TIME ZONE ${add(await timezoneFor(clientId))})::date`
        : 'cs.next_call_at';
      if (from) conds.push(`${col} >= ${add(from)}::date`);
      if (to)   conds.push(`${col} <= ${add(to)}::date`);
    }

    if (search) {
      const like  = add(`%${search}%`);
      // Operators type 0771234567 where the chat is stored as 94771234567.
      const digits = search.replace(/\D/g, '').replace(/^0+/, '');
      const phoneLike = digits.length >= 4 ? add(`%${digits}%`) : like;
      conds.push(`(cu.name ILIKE ${like} OR cu.phone_number ILIKE ${phoneLike}
        OR EXISTS (SELECT 1 FROM lead_call_log lx
                    WHERE lx.client_id=cu.client_id AND lx.phone_number=cu.phone_number
                      AND lx.note ILIKE ${like}))`);
    }

    const fromSql = `
      FROM customers cu
      LEFT JOIN customer_settings cs
             ON cs.phone_number=cu.phone_number AND cs.client_id=cu.client_id
      LEFT JOIN LATERAL (
        SELECT outcome, note, created_at, callback_on FROM lead_call_log l
         WHERE l.client_id=cu.client_id AND l.phone_number=cu.phone_number
         ORDER BY l.created_at DESC LIMIT 1) lc ON TRUE
      LEFT JOIN crm_users u ON u.id = cs.owned_by
      WHERE ${conds.join(' AND ')}`;

    // Callback views are worked in date order; everything else, newest chat first.
    const order = callback && callback !== 'none'
      ? 'cs.next_call_at ASC, cu.phone_number'
      : 'COALESCE(cu.last_customer_message_at, cu.updated_at) DESC NULLS LAST';

    const listParams = [...params, limit, (page - 1) * limit];
    const [rows, count] = await Promise.all([
      db.pgQuery(`
        SELECT cu.phone_number, cu.name, cs.lead_status, cs.lead_status_at, cs.next_call_at::text AS next_call_at,
               COALESCE(u.display_name, u.username) AS owned_by_name,
               cu.last_customer_message_at AS last_message_at,
               lc.outcome AS last_outcome, lc.note AS last_note, lc.created_at AS last_call_at,
               (SELECT COUNT(*) FROM lead_call_log lk
                 WHERE lk.client_id=cu.client_id AND lk.phone_number=cu.phone_number) AS call_count
        ${fromSql}
        ORDER BY ${order}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, listParams),
      db.pgQuery(`SELECT COUNT(*) ${fromSql}`, params),
    ]);
    res.json({ leads: rows.rows, total: parseInt(count.rows[0].count), page, limit });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * GET /api/leads/summary - the numbers on the filter chips.
 */
async function leadsSummary(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const today = todayLocal(await timezoneFor(clientId));
    const [byStatus, due, uncalled] = await Promise.all([
      db.pgQuery(
        `SELECT cs.lead_status AS status, COUNT(*) AS n
           FROM customers cu
           LEFT JOIN customer_settings cs
                  ON cs.phone_number=cu.phone_number AND cs.client_id=cu.client_id
          WHERE cu.client_id=$1
          GROUP BY cs.lead_status`, [clientId]),
      db.pgQuery(
        `SELECT COUNT(*) FILTER (WHERE next_call_at = $2::date) AS today,
                COUNT(*) FILTER (WHERE next_call_at < $2::date) AS overdue,
                COUNT(*) FILTER (WHERE next_call_at > $2::date) AS upcoming
           FROM customer_settings WHERE client_id=$1`, [clientId, today]),
      db.pgQuery(
        `SELECT COUNT(*) FROM customers cu
          WHERE cu.client_id=$1
            AND NOT EXISTS (SELECT 1 FROM lead_call_log lc
                             WHERE lc.client_id=cu.client_id AND lc.phone_number=cu.phone_number
                               AND lc.outcome <> 'note')`, [clientId]),
    ]);
    const counts = { new: 0 };
    let all = 0;
    for (const r of byStatus.rows) {
      const n = parseInt(r.n);
      all += n;
      counts[r.status || 'new'] = n;
    }
    res.json({
      all, counts,
      not_called: parseInt(uncalled.rows[0].count),
      today:   parseInt(due.rows[0].today),
      overdue:  parseInt(due.rows[0].overdue),
      upcoming: parseInt(due.rows[0].upcoming),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Same set as the income summary and the Meta Purchase event.
const PAID_STATUSES = ['payment_received', 'paid', 'delivered', 'done', 'complete'];

/** YYYY-MM-DD shifted by `n` days (calendar arithmetic, no time zone involved). */
function shiftDay(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * GET /api/leads/stats - lead volume, calls made and conversion for a period.
 *
 * Query: days (7, 30, ... ; 0 = all time) or date_from + date_to (YYYY-MM-DD).
 *
 * A lead is a chat whose first customer message falls in the period. It is
 * converted when it has an order in a paid status (payment received or
 * delivered); a pending or cancelled order is not a conversion. Calls count real attempts only; a bare note
 * is not a call. "Called" for the cohort looks at calls at any time, so a lead
 * rung a week after it arrived still counts as one we called.
 */
async function leadsStats(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const tz    = await timezoneFor(clientId);
    const today = todayLocal(tz);
    let from = cleanDate(req.query.date_from);
    let to   = cleanDate(req.query.date_to);
    if (!from && !to) {
      const days = req.query.days === undefined ? 30 : Math.max(0, parseInt(req.query.days) || 0);
      from = days ? shiftDay(today, -(days - 1)) : '1970-01-01';
      to   = today;
    }
    from = from || '1970-01-01';
    to   = to   || today;

    const r = await db.pgQuery(`
      WITH first_msg AS (
        SELECT phone_number, MIN(created_at) AS first_at
          FROM messages WHERE client_id=$1 AND sender_type='user'
         GROUP BY phone_number),
      cohort AS (
        SELECT f.phone_number,
               EXISTS (SELECT 1 FROM lead_call_log l
                        WHERE l.client_id=$1 AND l.phone_number=f.phone_number
                          AND l.outcome <> 'note') AS was_called,
               EXISTS (SELECT 1 FROM orders o
                        WHERE o.client_id=$1 AND o.phone_number=f.phone_number
                          AND o.status = ANY($5::text[])) AS has_order
          FROM first_msg f
          JOIN customers cu ON cu.client_id=$1 AND cu.phone_number=f.phone_number
         WHERE (f.first_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date),
      activity AS (
        SELECT COUNT(*) AS calls,
               COUNT(DISTINCT phone_number) AS leads_called,
               COUNT(DISTINCT phone_number) FILTER (WHERE outcome='answered') AS leads_reached
          FROM lead_call_log
         WHERE client_id=$1 AND outcome <> 'note'
           AND (created_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date)
      SELECT (SELECT COUNT(*) FROM cohort)                                   AS leads,
             (SELECT COUNT(*) FROM cohort WHERE has_order)                   AS converted,
             (SELECT COUNT(*) FROM cohort WHERE was_called)                  AS cohort_called,
             (SELECT COUNT(*) FROM cohort WHERE was_called AND has_order)    AS cohort_called_converted,
             (SELECT COUNT(*) FROM cohort WHERE NOT was_called AND has_order) AS cohort_uncalled_converted,
             a.calls, a.leads_called, a.leads_reached
        FROM activity a`, [clientId, tz, from, to, PAID_STATUSES]);

    const n = (k) => parseInt(r.rows[0][k]) || 0;
    const leads = n('leads'), called = n('cohort_called');
    const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
    res.json({
      from, to,
      leads,
      converted: n('converted'),
      conversion_rate: pct(n('converted'), leads),
      called,
      not_called: leads - called,
      called_conversion_rate: pct(n('cohort_called_converted'), called),
      not_called_conversion_rate: pct(n('cohort_uncalled_converted'), leads - called),
      calls_made: n('calls'),
      leads_called: n('leads_called'),
      leads_reached: n('leads_reached'),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * PATCH /api/customers/:phone/lead-status - body { status } (null clears to New).
 */
async function setLeadStatus(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { phone } = req.params;
  const status = req.body.status || null;
  if (status && !LEAD_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${LEAD_STATUSES.join(', ')} or empty` });
  }
  try {
    if (!(await chatExists(clientId, phone))) return res.status(404).json({ error: 'Chat not found' });
    await db.pgQuery(
      `INSERT INTO customer_settings (phone_number, client_id, lead_status, lead_status_at, lead_status_by)
       VALUES ($1,$2,$3,NOW(),$4)
       ON CONFLICT (phone_number, client_id)
       DO UPDATE SET lead_status=$3, lead_status_at=NOW(), lead_status_by=$4`,
      [phone, clientId, status, req.user.uid || null]);
    res.json({ ok: true, status });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * GET /api/customers/:phone/lead - one chat's status and next call day.
 */
async function getLead(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const [r, last, n] = await Promise.all([
      db.pgQuery(
        `SELECT lead_status, next_call_at::text AS next_call_at
           FROM customer_settings WHERE client_id=$1 AND phone_number=$2`, [clientId, req.params.phone]),
      db.pgQuery(
        `SELECT l.outcome, l.note, l.callback_on::text AS callback_on, l.created_at,
                COALESCE(u.display_name, u.username) AS by_name
           FROM lead_call_log l LEFT JOIN crm_users u ON u.id = l.created_by
          WHERE l.client_id=$1 AND l.phone_number=$2
          ORDER BY l.created_at DESC LIMIT 1`, [clientId, req.params.phone]),
      db.pgQuery(
        `SELECT COUNT(*) FROM lead_call_log WHERE client_id=$1 AND phone_number=$2`,
        [clientId, req.params.phone]),
    ]);
    res.json({
      lead_status: r.rows[0]?.lead_status || null,
      next_call_at: r.rows[0]?.next_call_at || null,
      last_call: last.rows[0] || null,
      call_count: parseInt(n.rows[0].count),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * GET /api/customers/:phone/calls - the call history for one chat, newest first.
 */
async function listCalls(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const r = await db.pgQuery(
      `SELECT l.id, l.outcome, l.note, l.callback_on::text AS callback_on, l.created_at,
              COALESCE(u.display_name, u.username) AS by_name
         FROM lead_call_log l
         LEFT JOIN crm_users u ON u.id = l.created_by
        WHERE l.client_id=$1 AND l.phone_number=$2
        ORDER BY l.created_at DESC LIMIT 100`, [clientId, req.params.phone]);
    res.json({ calls: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * POST /api/customers/:phone/calls - body { outcome, note?, callback_on? }.
 *
 * "call_back" needs a date and sets the chat's next call day. Any other
 * outcome clears it: the promise was kept or is no longer being made.
 */
async function logCall(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { phone } = req.params;
  const { outcome } = req.body;
  const note = (req.body.note || '').trim().slice(0, 1000) || null;
  if (!CALL_OUTCOMES.includes(outcome)) {
    return res.status(400).json({ error: `outcome must be one of ${CALL_OUTCOMES.join(', ')}` });
  }
  // A bare note is not a call: it never touches the promised call-back day.
  const isNote = outcome === 'note';
  if (isNote && !note) return res.status(400).json({ error: 'A note cannot be empty' });
  let callbackOn = null;
  if (outcome === 'call_back') {
    callbackOn = cleanDate(req.body.callback_on);
    if (!callbackOn) return res.status(400).json({ error: 'A call-back needs a date (YYYY-MM-DD)' });
  }
  try {
    if (!(await chatExists(clientId, phone))) return res.status(404).json({ error: 'Chat not found' });
    const ins = await db.pgQuery(
      `INSERT INTO lead_call_log (client_id, phone_number, outcome, note, callback_on, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
      [clientId, phone, outcome, note, callbackOn, req.user.uid || null]);
    // "dialed" is the Call button being tapped: the number was rung but no
    // result is known yet, so a promised call-back day must stay in place.
    if (!isNote && outcome !== 'dialed') {
      await db.pgQuery(
        `INSERT INTO customer_settings (phone_number, client_id, next_call_at)
         VALUES ($1,$2,$3)
         ON CONFLICT (phone_number, client_id) DO UPDATE SET next_call_at=$3`,
        [phone, clientId, callbackOn]);
    }
    res.json({ ok: true, id: ins.rows[0].id, next_call_at: isNote ? undefined : callbackOn });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = { todayLocal, listLeads, leadsSummary, leadsStats, setLeadStatus, getLead, listCalls, logCall, LEAD_STATUSES, CALL_OUTCOMES };
