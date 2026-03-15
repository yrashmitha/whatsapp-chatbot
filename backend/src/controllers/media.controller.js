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
  if (!req.file) return res.status(400).json({ error: 'No image file received' });
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

module.exports = { uploadMediaFile, listMedia, createMedia, updateMedia, deleteMedia, proxyWhatsAppMedia };
