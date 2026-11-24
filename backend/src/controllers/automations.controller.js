/**
 * @module controllers/automations
 * @description The owner's automatic message rules: list, create, change,
 * delete, and preview who a rule would message right now.
 */

'use strict';

const db = require('../db');
const resolveClientId = require('../middleware/resolveClientId');
const auto = require('../services/automations');

const missingTable = (e) => e.code === '42P01';

/** GET /api/automations: the rules, with the last 7 days of results each. */
async function listRules(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const { rows } = await db.pgQuery('SELECT * FROM auto_rules WHERE client_id=$1 ORDER BY id', [clientId]);
    const st = await auto.stats(clientId, 7).catch(() => ({}));
    const tz = await auto.timezoneFor(clientId);
    res.json({
      rules: rows.map(r => ({ ...r, min_hours: Number(r.min_hours), max_hours: Number(r.max_hours), gap_hours: Number(r.gap_hours),
        stats: st[r.id] || { sent: 0, failed: 0, skipped: 0, replied: 0, paid: 0 } })),
      max_hours_cap: auto.MAX_HOURS_CAP,
      timezone: tz,
      hour_now: auto.hourIn(tz),
    });
  } catch (e) {
    if (missingTable(e)) return res.json({ rules: [], max_hours_cap: auto.MAX_HOURS_CAP });
    res.status(500).json({ error: e.message });
  }
}

/** POST /api/automations */
async function createRule(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const r = auto.validateRule(req.body);
    const { rows } = await db.pgQuery(
      `INSERT INTO auto_rules (client_id, name, enabled, min_hours, max_hours, gap_hours, quiet_start, quiet_end, conditions, message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING *`,
      [clientId, r.name, r.enabled, r.min_hours, r.max_hours, r.gap_hours, r.quiet_start, r.quiet_end, JSON.stringify(r.conditions), r.message]);
    res.json({ rule: rows[0] });
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}

/** PATCH /api/automations/:id: the whole rule, or just { enabled } to switch it. */
async function updateRule(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const id = parseInt(req.params.id, 10);
  try {
    const keys = Object.keys(req.body || {});
    if (keys.length === 1 && keys[0] === 'enabled') {
      const { rows } = await db.pgQuery(
        'UPDATE auto_rules SET enabled=$3, updated_at=NOW() WHERE id=$1 AND client_id=$2 RETURNING *', [id, clientId, !!req.body.enabled]);
      if (!rows.length) return res.status(404).json({ error: 'Rule not found' });
      return res.json({ rule: rows[0] });
    }
    const r = auto.validateRule(req.body);
    const { rows } = await db.pgQuery(
      `UPDATE auto_rules SET name=$3, enabled=$4, min_hours=$5, max_hours=$6, gap_hours=$7, quiet_start=$8, quiet_end=$9,
              conditions=$10::jsonb, message=$11, updated_at=NOW()
        WHERE id=$1 AND client_id=$2 RETURNING *`,
      [id, clientId, r.name, r.enabled, r.min_hours, r.max_hours, r.gap_hours, r.quiet_start, r.quiet_end, JSON.stringify(r.conditions), r.message]);
    if (!rows.length) return res.status(404).json({ error: 'Rule not found' });
    res.json({ rule: rows[0] });
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}

/** DELETE /api/automations/:id (its send history stays, for the record). */
async function deleteRule(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const r = await db.pgQuery('DELETE FROM auto_rules WHERE id=$1 AND client_id=$2', [parseInt(req.params.id, 10), clientId]);
    res.json({ ok: r.rowCount > 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * POST /api/automations/preview: who this rule (saved or not) would message
 * if it ran now. Sends nothing.
 */
async function previewRule(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const r = auto.validateRule({ ...req.body, enabled: false });
    const list = await auto.candidates(clientId, { ...r, id: parseInt(req.body?.id, 10) || 0 }, 500);
    const tz = await auto.timezoneFor(clientId);
    res.json({
      count: list.length,
      quiet_now: auto.isQuiet(auto.hourIn(tz), r.quiet_start, r.quiet_end),
      sample: list.slice(0, 30).map(c => ({
        phone: c.phone_number, name: c.name,
        hours_ago: Math.round((Date.now() - new Date(c.last_customer_message_at).getTime()) / 36e5 * 10) / 10,
        text: auto.fillText(r.message, c.name),
      })),
    });
  } catch (e) {
    if (missingTable(e)) return res.status(503).json({ error: 'Automations are still being set up. Try again in a minute.' });
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

module.exports = { listRules, createRule, updateRule, deleteRule, previewRule };
