/**
 * @module controllers/media.controller
 * @description Handlers for the media library API and WhatsApp media proxy.
 */

'use strict';

const axios = require('axios');
const db    = require('../db');
const clientRouter = require('../services/clientRouter');
const { waToken }  = require('../services/whatsapp');
const { PUBLIC_URL } = require('../config/env');
const resolveClientId = require('../middleware/resolveClientId');

/**
 * POST /api/media/upload — upload an image file to the persistent volume.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {void}
 */
function uploadMediaFile(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file received. Use an image, a PDF or an MP4 video (max 16 MB).' });
  const base = PUBLIC_URL || '';
  const url  = `${base}/uploads/${req.file.filename}`;
  res.json({ ok: true, url });
}

/**
 * GET /api/media — list all media items for the current client.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function listMedia(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try { res.json({ media: await db.getClientMedia(clientId) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * POST /api/media — add a new media library entry.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function createMedia(req, res) {
  const clientId = resolveClientId(req);
  const { title, description, image_url, sort_order = 0 } = req.body;
  if (!title || !description || !image_url) return res.status(400).json({ error: 'title, description, image_url required' });
  try {
    const id = await db.insertMedia(clientId, title, description, image_url, sort_order);
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * PATCH /api/media/:id — update a media library entry.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function updateMedia(req, res) {
  const clientId = resolveClientId(req);
  const { title, description, image_url, sort_order = 0 } = req.body;
  try {
    await db.updateMedia(req.params.id, clientId, title, description, image_url, sort_order);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * DELETE /api/media/:id — delete a media library entry.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function deleteMedia(req, res) {
  const clientId = resolveClientId(req);
  try {
    await db.deleteMedia(req.params.id, clientId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * The ids from a request that are this client's own library items, in the
 * order given and without repeats, so a group can never point at another
 * client's files.
 *
 * @param {string} clientId
 * @param {*} ids
 * @returns {Promise<number[]>}
 */
async function ownMediaIds(clientId, ids) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger))];
  if (!wanted.length) return [];
  const { rows } = await db.pgQuery('SELECT id FROM client_media WHERE client_id=$1 AND id = ANY($2::int[])', [clientId, wanted]);
  const mine = new Set(rows.map(r => r.id));
  return wanted.filter(id => mine.has(id));
}

/** A group's name and items from the request body, checked; throws a message for the operator. */
async function groupFromBody(clientId, body) {
  const name = String(body?.name || '').trim();
  if (!name) throw Object.assign(new Error('Give the group a name'), { status: 400 });
  if (name.length > 60) throw Object.assign(new Error('Keep the name under 60 characters'), { status: 400 });
  const ids = await ownMediaIds(clientId, body?.media_ids);
  if (!ids.length) throw Object.assign(new Error('Pick at least one item for the group'), { status: 400 });
  return { name, ids };
}

/**
 * GET /api/media/groups — the client's saved media groups.
 * An empty list when the table is missing, so the picker still opens.
 */
async function listMediaGroups(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const { rows } = await db.pgQuery(
      'SELECT id, name, media_ids FROM client_media_groups WHERE client_id=$1 ORDER BY lower(name)', [clientId]);
    res.json({ groups: rows });
  } catch (e) {
    if (e.code === '42P01') return res.json({ groups: [] }); // table not there: no groups
    res.status(500).json({ error: e.message });
  }
}

/** POST /api/media/groups — save a new group. Body: { name, media_ids } in send order. */
async function createMediaGroup(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const { name, ids } = await groupFromBody(clientId, req.body);
    const { rows } = await db.pgQuery(
      'INSERT INTO client_media_groups (client_id, name, media_ids) VALUES ($1,$2,$3::int[]) RETURNING id', [clientId, name, ids]);
    res.json({ ok: true, id: rows[0].id });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}

/** PATCH /api/media/groups/:id — rename a group or change its items and order. */
async function updateMediaGroup(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const { name, ids } = await groupFromBody(clientId, req.body);
    const r = await db.pgQuery(
      'UPDATE client_media_groups SET name=$3, media_ids=$4::int[] WHERE id=$1 AND client_id=$2', [req.params.id, clientId, name, ids]);
    if (!r.rowCount) return res.status(404).json({ error: 'Group not found' });
    res.json({ ok: true });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}

/** DELETE /api/media/groups/:id — delete a group (its library items stay). */
async function deleteMediaGroup(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    await db.pgQuery('DELETE FROM client_media_groups WHERE id=$1 AND client_id=$2', [req.params.id, clientId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * GET /api/media/:mediaId — proxy a WhatsApp media file by fetching its temporary URL.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function proxyWhatsAppMedia(req, res) {
  const clientId = resolveClientId(req);
  try {
    const client = clientId ? await clientRouter.getClientById(clientId) : null;
    const token = waToken(client);
    const urlRes = await axios.get(`https://graph.facebook.com/v18.0/${req.params.mediaId}`, { headers: { Authorization: `Bearer ${token}` } });
    const mediaUrl = urlRes.data.url;
    const mediaRes = await axios.get(mediaUrl, { headers: { Authorization: `Bearer ${token}` }, responseType: 'arraybuffer' });
    res.set('Content-Type', mediaRes.headers['content-type'] || 'application/octet-stream');
    res.send(Buffer.from(mediaRes.data));
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = { uploadMediaFile, listMedia, createMedia, updateMedia, deleteMedia, proxyWhatsAppMedia,
  listMediaGroups, createMediaGroup, updateMediaGroup, deleteMediaGroup };
