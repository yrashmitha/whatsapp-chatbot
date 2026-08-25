/**
 * @module controllers/auth.controller
 * @description Handlers for CRM authentication routes (login, me, set-password).
 */

'use strict';

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../db');
const { JWT_SECRET } = require('../config/env');
const { sanitize }   = require('../services/permissions');

/**
 * POST /auth/login — authenticate a superadmin or client user.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function login(req, res) {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  try {
    // Check superadmin first
    const saRow = await db.pgQuery(`SELECT * FROM crm_users WHERE username=$1 AND role='superadmin'`, [username]);
    if (saRow.rows.length > 0) {
      const valid = await bcrypt.compare(password, saRow.rows[0].password_hash);
      if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
      const token = jwt.sign({ sub: username, role: 'superadmin', clientId: null }, JWT_SECRET, { expiresIn: '7d' });
      const user = { role: 'superadmin', clientId: null, name: 'Super Admin' };
      return res.json({ token, user });
    }
    // Check for an operator: a real user row scoped to one client.
    const opRow = await db.pgQuery(
      `SELECT u.id, u.password_hash, u.client_id, u.display_name, u.permissions, u.active,
              c.name AS client_name, c.type AS client_type
         FROM crm_users u JOIN clients c ON c.id = u.client_id
        WHERE u.username = $1 AND u.client_id IS NOT NULL AND c.active = TRUE`,
      [username]
    );
    if (opRow.rows.length > 0) {
      const op = opRow.rows[0];
      const valid = await bcrypt.compare(password, op.password_hash);
      // Same message either way: a disabled account must not be distinguishable
      // from a wrong password, or it confirms the username to whoever is trying.
      if (!valid || !op.active) return res.status(401).json({ error: 'Invalid credentials' });
      const permissions = sanitize(op.permissions);
      const token = jwt.sign(
        { sub: username, role: 'client', clientId: op.client_id, uid: op.id,
          displayName: op.display_name || username, permissions },
        JWT_SECRET, { expiresIn: '7d' }
      );
      const horoOp = await db.pgQuery(
        `SELECT 1 FROM plugin_configs WHERE client_id=$1 AND plugin_id='horoscope_reading' LIMIT 1`,
        [op.client_id]
      );
      const cfgOp = await db.pgQuery(
        `SELECT plugin_enabled FROM client_configs WHERE client_id=$1`, [op.client_id]
      );
      return res.json({
        token,
        user: {
          role: 'client', clientId: op.client_id, uid: op.id,
          name: op.display_name || username, clientName: op.client_name,
          clientType: op.client_type, permissions,
          plugin_enabled: !!cfgOp.rows[0]?.plugin_enabled,
          horoscope_enabled: horoOp.rows.length > 0,
        },
      });
    }

    // Check client user
    const cfgRow = await db.pgQuery(
      `SELECT cc.crm_password_hash, cc.plugin_enabled, c.name, c.type
       FROM client_configs cc JOIN clients c ON c.id=cc.client_id WHERE cc.client_id=$1 AND c.active=TRUE`,
      [username]
    );
    if (!cfgRow.rows.length || !cfgRow.rows[0].crm_password_hash)
      return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, cfgRow.rows[0].crm_password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    // Check if horoscope plugin is configured for this client
    const horoRow = await db.pgQuery(
      `SELECT 1 FROM plugin_configs WHERE client_id=$1 AND plugin_id='horoscope_reading' LIMIT 1`,
      [username]
    );
    const token = jwt.sign({ sub: username, role: 'client', clientId: username }, JWT_SECRET, { expiresIn: '7d' });
    const user = {
      role: 'client', clientId: username, name: cfgRow.rows[0].name,
      clientType: cfgRow.rows[0].type, plugin_enabled: !!cfgRow.rows[0].plugin_enabled,
      horoscope_enabled: horoRow.rows.length > 0,
    };
    return res.json({ token, user });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * GET /auth/me — return the current authenticated user's JWT payload.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {void}
 */
function me(req, res) {
  res.json(req.user);
}

/**
 * POST /auth/set-password — set CRM password for a client (superadmin or self).
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function setPassword(req, res) {
  const { clientId, password } = req.body;
  if (!clientId || !password) return res.status(400).json({ error: 'clientId and password required' });
  // An operator's token carries the same clientId as the owner's, so the check
  // below would let them change the shared client password and lock the owner
  // out. Setting it is the owner's or the superadmin's job, never an operator's.
  if (req.user.uid) return res.status(403).json({ error: 'Forbidden' });
  if (req.user.role !== 'superadmin' && req.user.clientId !== clientId)
    return res.status(403).json({ error: 'Forbidden' });
  try {
    const hash = await bcrypt.hash(password, 10);
    await db.pgQuery(`UPDATE client_configs SET crm_password_hash=$1 WHERE client_id=$2`, [hash, clientId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = { login, me, setPassword };
