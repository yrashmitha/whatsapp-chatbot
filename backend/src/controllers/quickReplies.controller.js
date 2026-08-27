'use strict';

const resolveClientId = require('../middleware/resolveClientId');
const { getQuickReplies, createQuickReply, updateQuickReply, deleteQuickReply } = require('../db/quickReplies.db');

async function list(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const rows = await getQuickReplies(clientId);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

async function create(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { title, text } = req.body;
  if (!title?.trim() || !text?.trim()) return res.status(400).json({ error: 'title and text required' });
  try {
    const row = await createQuickReply(clientId, title.trim(), text.trim());
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

async function update(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { title, text } = req.body;
  if (!title?.trim() || !text?.trim()) return res.status(400).json({ error: 'title and text required' });
  try {
    const row = await updateQuickReply(clientId, req.params.id, title.trim(), text.trim());
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

module.exports = { list, create, update, remove };
