'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');

/**
 * GET /api/flow-config
 * Returns the logged-in client's flow_config.
 * Superadmin can pass ?client_id=xxx to view any client's flow.
 */
router.get('/', async (req, res) => {
  const clientId = req.user?.role === 'superadmin'
    ? (req.query.client_id || req.user?.clientId)
    : req.user?.clientId;

  if (!clientId) return res.status(400).json({ error: 'No client context' });

  try {
    const { rows } = await db.pgQuery(
      'SELECT flow_config FROM clients WHERE id=$1',
      [clientId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });
    res.json(rows[0].flow_config || { nodes: [], edges: [], globalTools: ['search_knowledge'] });
  } catch (e) {
    console.error('[FLOW-CONFIG][get] error:', e.message);
    res.status(500).json({ error: 'Failed to load flow config' });
  }
});

/**
 * PATCH /api/flow-config
 * Save the logged-in client's flow_config.
 * Superadmin can pass client_id in body to save any client's flow.
 */
router.patch('/', async (req, res) => {
  const clientId = req.user?.role === 'superadmin'
    ? (req.body.client_id || req.user?.clientId)
    : req.user?.clientId;

  if (!clientId) return res.status(400).json({ error: 'No client context' });

  const { nodes, edges, globalTools } = req.body;
  if (!nodes || !edges) return res.status(400).json({ error: 'nodes and edges are required' });

  try {
    await db.pgQuery(
      'UPDATE clients SET flow_config=$1 WHERE id=$2',
      [JSON.stringify({ nodes, edges, globalTools: globalTools || ['search_knowledge'] }), clientId]
    );
    console.log(`[FLOW-CONFIG][save] client=${clientId} nodes=${nodes.length} edges=${edges.length}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[FLOW-CONFIG][patch] error:', e.message);
    res.status(500).json({ error: 'Failed to save flow config' });
  }
});

/**
 * GET /api/flow-config/session/:token
 * Superadmin only — returns phase state for a consult session + consult flow config.
 */
router.get('/session/:token', async (req, res) => {
  if (req.user?.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });

  try {
    const { rows } = await db.pgQuery(
      `SELECT cs.current_phase, cs.completed_phases, cc.flow_config
       FROM consult_sessions cs
       LEFT JOIN consult_config cc ON cc.id = 1
       WHERE cs.session_token = $1`,
      [req.params.token]
    );
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });

    res.json({
      currentPhase:    rows[0].current_phase    || null,
      completedPhases: rows[0].completed_phases || [],
      flowConfig:      rows[0].flow_config      || null,
    });
  } catch (e) {
    console.error('[FLOW-CONFIG][session] error:', e.message);
    res.status(500).json({ error: 'Failed to load session flow' });
  }
});

/**
 * GET /api/flow-config/consult
 * Superadmin only — get the Nova consult service flow config.
 */
router.get('/consult', async (req, res) => {
  if (req.user?.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });

  try {
    const { rows } = await db.pgQuery('SELECT flow_config FROM consult_config WHERE id=1');
    res.json(rows[0]?.flow_config || { nodes: [], edges: [], globalTools: ['search_knowledge'] });
  } catch (e) {
    console.error('[FLOW-CONFIG][consult-get] error:', e.message);
    res.status(500).json({ error: 'Failed to load consult flow config' });
  }
});

/**
 * PATCH /api/flow-config/consult
 * Superadmin only — save the Nova consult service flow config.
 */
router.patch('/consult', async (req, res) => {
  if (req.user?.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });

  const { nodes, edges, globalTools } = req.body;
  if (!nodes || !edges) return res.status(400).json({ error: 'nodes and edges are required' });

  try {
    await db.pgQuery(
      'UPDATE consult_config SET flow_config=$1 WHERE id=1',
      [JSON.stringify({ nodes, edges, globalTools: globalTools || ['search_knowledge'] })]
    );
    console.log(`[FLOW-CONFIG][consult-save] nodes=${nodes.length} edges=${edges.length}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[FLOW-CONFIG][consult-patch] error:', e.message);
    res.status(500).json({ error: 'Failed to save consult flow config' });
  }
});

module.exports = router;
