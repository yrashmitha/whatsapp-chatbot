'use strict';

const resolveClientId = require('../middleware/resolveClientId');
const { getQuickReplies, createQuickReply, updateQuickReply, deleteQuickReply, forkQuickReply } = require('../db/quickReplies.db');

/** 'A' | 'B' | null (shared). Anything else, including 'shared' and '', is shared. */
function armOf(v) { return v === 'A' || v === 'B' ? v : null; }

async function list(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    // ?strategy=A|B limits the list to what that prompt strategy would send,
    // which is what the chat's quick-reply picker asks for.
    const rows = await getQuickReplies(clientId, armOf(req.query.strategy));
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

async function create(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { title, text } = req.body;
  const category = String(req.body.category ?? '').trim().slice(0, 40);
  if (!title?.trim() || !text?.trim()) return res.status(400).json({ error: 'title and text required' });
  try {
    const row = await createQuickReply(clientId, title.trim(), text.trim(), category, armOf(req.body.strategy));
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

async function update(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { title, text } = req.body;
  const category = String(req.body.category ?? '').trim().slice(0, 40);
  if (!title?.trim() || !text?.trim()) return res.status(400).json({ error: 'title and text required' });
  // Absent leaves the strategy tag alone; present sets it (null or '' = shared).
  const strategy = req.body.strategy === undefined ? undefined : armOf(req.body.strategy);
  try {
    const row = await updateQuickReply(clientId, req.params.id, title.trim(), text.trim(), category, strategy);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

async function remove(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    await deleteQuickReply(clientId, req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** POST /:id/fork { strategy: 'A'|'B' } - copy a reply for one strategy only. */
async function fork(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const to = armOf(req.body?.strategy);
  if (!to) return res.status(400).json({ error: "strategy must be 'A' or 'B'" });
  try {
    const row = await forkQuickReply(clientId, req.params.id, to);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = { list, create, update, remove, fork };
