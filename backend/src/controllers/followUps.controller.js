/**
 * @module controllers/followUps.controller
 * @description The follow-up work queue.
 */

'use strict';

const resolveClientId = require('../middleware/resolveClientId');
const { buildQueue } = require('../services/followUpQueue');

/**
 * GET /api/follow-ups — who to message now, and what to say.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function listFollowUps(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    res.json(await buildQueue(clientId));
  } catch (e) {
    console.error('[FOLLOW-UP] queue failed:', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

module.exports = { listFollowUps };
