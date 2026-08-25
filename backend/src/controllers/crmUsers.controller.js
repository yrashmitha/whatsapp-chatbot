/**
 * @module controllers/crmUsers.controller
 * @description Managing the operators who work a client's inbox.
 *
 * Every query is scoped by client_id as well as by row id, so a client who
 * guesses another tenant's user id still touches nothing. Password hashes never
 * leave this file.
 */

'use strict';

const bcrypt = require('bcryptjs');
const db     = require('../db');
const resolveClientId = require('../middleware/resolveClientId');
const { PERMISSIONS, OPERATOR_DEFAULT, sanitize } = require('../services/permissions');


/** Columns that are safe to return. Deliberately not `*`. */
const SAFE = 'id, username, display_name, permissions, active, created_at';

/**
 * GET /api/crm-users — the operators belonging to this client.
 */
async function listUsers(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const r = await db.pgQuery(
      `SELECT ${SAFE} FROM crm_users WHERE client_id=$1 ORDER BY active DESC, username`,
      [clientId]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * GET /api/crm-users/permissions — the catalogue the UI renders.
 *
 * Available to any authenticated user, because the UI needs the labels to show
 * a person what they themselves hold. It is a list of names, not a grant.
 */
function listPermissions(_req, res) {
  res.json({ permissions: PERMISSIONS, operator_default: OPERATOR_DEFAULT });
}

/**
 * POST /api/crm-users — create an operator.
 */
async function createUser(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { username, password, display_name, permissions } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (String(password).length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });

  // Usernames are unique across the whole table, so an operator can never
  // collide with a client id and shadow an owner login.
  const taken = await db.pgQuery(`SELECT 1 FROM crm_users WHERE username=$1`, [username]);
  if (taken.rows.length) return res.status(409).json({ error: 'That username is taken' });
  const isClientId = await db.pgQuery(`SELECT 1 FROM clients WHERE id=$1`, [username]);
  if (isClientId.rows.length) return res.status(409).json({ error: 'That username belongs to a client login' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const perms = permissions === undefined ? OPERATOR_DEFAULT : sanitize(permissions);
    const r = await db.pgQuery(
      `INSERT INTO crm_users (username, password_hash, role, client_id, display_name, permissions, active)
       VALUES ($1,$2,'client',$3,$4,$5::jsonb,TRUE) RETURNING ${SAFE}`,
      [username, hash, clientId, display_name || username, JSON.stringify(perms)]
    );
    console.log(`[USERS] ${req.user.sub} created operator ${username} for ${clientId}`);
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * PATCH /api/crm-users/:id — rename, re-permission, enable or disable.
 *
 * Disabling rather than deleting is deliberate: a removed row would orphan
 * every sale credited to that person and quietly change a closed payroll
 * period.
 */
async function updateUser(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { display_name, permissions, active } = req.body || {};
  try {
    const r = await db.pgQuery(
      `UPDATE crm_users
          SET display_name = COALESCE($3, display_name),
              permissions  = COALESCE($4::jsonb, permissions),
              active       = COALESCE($5, active)
        WHERE id=$1 AND client_id=$2
        RETURNING ${SAFE}`,
      [req.params.id, clientId,
       display_name ?? null,
       permissions === undefined ? null : JSON.stringify(sanitize(permissions)),
       active === undefined ? null : !!active]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'No such user' });
    console.log(`[USERS] ${req.user.sub} updated operator ${r.rows[0].username}`);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * POST /api/crm-users/:id/password — set a new password for an operator.
 */
async function resetPassword(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { password } = req.body || {};
  if (!password || String(password).length < 8)
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await db.pgQuery(
      `UPDATE crm_users SET password_hash=$3 WHERE id=$1 AND client_id=$2 RETURNING username`,
      [req.params.id, clientId, hash]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'No such user' });
    console.log(`[USERS] ${req.user.sub} reset the password for ${r.rows[0].username}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = { listUsers, listPermissions, createUser, updateUser, resetPassword };
