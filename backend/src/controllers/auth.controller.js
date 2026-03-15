/**
 * @module controllers/auth.controller
 * @description Handlers for CRM authentication routes (login, me, set-password).
 */

'use strict';

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../db');
const { JWT_SECRET } = require('../config/env');

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
    // Check client user
    const cfgRow = await db.pgQuery(
      `SELECT cc.crm_password_hash, c.name FROM client_configs cc JOIN clients c ON c.id=cc.client_id WHERE cc.client_id=$1 AND c.active=TRUE`,
      [username]
    );
    if (!cfgRow.rows.length || !cfgRow.rows[0].crm_password_hash)
      return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, cfgRow.rows[0].crm_password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ sub: username, role: 'client', clientId: username }, JWT_SECRET, { expiresIn: '7d' });
    const user = { role: 'client', clientId: username, name: cfgRow.rows[0].name };
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
  if (req.user.role !== 'superadmin' && req.user.clientId !== clientId)
    return res.status(403).json({ error: 'Forbidden' });
  try {
    const hash = await bcrypt.hash(password, 10);
    await db.pgQuery(`UPDATE client_configs SET crm_password_hash=$1 WHERE client_id=$2`, [hash, clientId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = { login, me, setPassword };
