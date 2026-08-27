'use strict';

const resolveClientId = require('../middleware/resolveClientId');
const { getQuickReplies, createQuickReply, updateQuickReply, deleteQuickReply } = require('../db/quickReplies.db');

/**
 * Check the services a block claims to sell before storing them.
 *
 * These figures become payroll and become what Meta optimises on, so a typo
 * here is expensive and invisible. A price entered as "Rs 1,500" would store,
 * render as nothing in the block, and record orders worth zero - so it is
 * refused while somebody is still looking at the form.
 *
 * @param {*} raw
 * @returns {{services: Array, error: string|null}}
 */
function parseServices(raw) {
  if (raw == null || raw === '') return { services: [], error: null };
  if (!Array.isArray(raw)) return { services: [], error: 'services must be a list' };

  const out = [];
  const seen = new Set();
  for (const s of raw) {
    if (!s || typeof s !== 'object') return { services: [], error: 'each service must be an object' };

    const key = String(s.key ?? '').trim().toLowerCase();
    if (!key) return { services: [], error: 'every service needs a key' };
    // The key goes into a {{price:key}} token, which only reads these
    // characters. Anything else would silently fail to resolve.
    if (!/^[a-z0-9_-]+$/.test(key)) {
      return { services: [], error: `"${key}" may only use letters, numbers, dash and underscore` };
    }
    if (seen.has(key)) return { services: [], error: `"${key}" is listed twice` };
    seen.add(key);

    const price = Number(s.price);
    if (!Number.isFinite(price) || price < 0) {
      return { services: [], error: `"${key}" needs a price as a plain number` };
    }

    let anchor = null;
    if (s.anchor != null && s.anchor !== '') {
      anchor = Number(s.anchor);
      if (!Number.isFinite(anchor) || anchor < 0) {
        return { services: [], error: `"${key}" needs its usual price as a plain number` };
      }
    }

    out.push({
      key,
      label: String(s.label ?? '').trim() || key,
      price,
      anchor,
    });
  }
  return { services: out, error: null };
}

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
  const { services, error } = parseServices(req.body.services);
  if (error) return res.status(400).json({ error });
  try {
    const row = await createQuickReply(clientId, title.trim(), text.trim(), services);
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

async function update(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { title, text } = req.body;
  if (!title?.trim() || !text?.trim()) return res.status(400).json({ error: 'title and text required' });
  const { services, error } = parseServices(req.body.services);
  if (error) return res.status(400).json({ error });
  try {
    const row = await updateQuickReply(clientId, req.params.id, title.trim(), text.trim(), services);
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

module.exports = { list, create, update, remove, parseServices };
