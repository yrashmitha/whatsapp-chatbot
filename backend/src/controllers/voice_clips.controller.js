'use strict';

const db = require('../db');
const clientRouter = require('../services/clientRouter');
const { sendWhatsAppAudio } = require('../services/whatsapp');
const { PUBLIC_URL } = require('../config/env');
const resolveClientId = require('../middleware/resolveClientId');
const { transcodeToOggOpus } = require('../services/audioTranscode');
const path = require('path');

/**
 * POST /api/voice-clips/send-recording - record in the chat and send it now.
 *
 * Deliberately does not create a library entry. A one-off reply to one customer
 * is not a reusable clip, and making an operator name it and invent a trigger
 * keyword before they can answer somebody is why nobody would use this.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function sendRecording(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  if (!req.file) return res.status(400).json({ error: 'audio file required' });
  const phone = (req.body?.phone || '').trim();
  if (!phone) return res.status(400).json({ error: 'phone required' });

  try {
    const stored = await transcodeToOggOpus(req.file.path);
    const audioUrl = `${PUBLIC_URL || ''}/uploads/${path.basename(stored)}`;
    const client = await clientRouter.getClientById(clientId);
    const wamid = await sendWhatsAppAudio(phone, audioUrl, client);
    await db.insertMessage(phone, '[Voice note]', 'bot', null, clientId, 'audio', audioUrl,
                           wamid, null, { sentBy: req.user?.uid ?? null });
    res.json({ ok: true, audio_url: audioUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /api/voice-clips — list all voice clips for the current client.
 */
async function listVoiceClips(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const clips = await db.getVoiceClips(clientId);
    res.json({ clips });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /api/voice-clips — upload audio and create a voice clip entry.
 * Expects multipart/form-data with fields: file (audio), name, trigger_keyword.
 */
async function createVoiceClip(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  if (!req.file)  return res.status(400).json({ error: 'audio file required' });

  const { name, trigger_keyword } = req.body;
  if (!name || !name.trim())                   return res.status(400).json({ error: 'name required' });
  if (!trigger_keyword || !trigger_keyword.trim()) return res.status(400).json({ error: 'trigger_keyword required' });

  const keyword = trigger_keyword.trim().toLowerCase().replace(/\s+/g, '_');
  // Whatever was uploaded becomes Ogg/Opus, or WhatsApp shows it as a file.
  const stored = await transcodeToOggOpus(req.file.path);
  const audioUrl = `${PUBLIC_URL || ''}/uploads/${path.basename(stored)}`;

  try {
    const id = await db.insertVoiceClip(clientId, name.trim(), keyword, audioUrl);
    res.json({ ok: true, id, audio_url: audioUrl, trigger_keyword: keyword });
  } catch (e) {
    if (e.message?.includes('unique') || e.code === '23505') {
      return res.status(409).json({ error: `Trigger keyword "${keyword}" already exists` });
    }
    res.status(500).json({ error: e.message });
  }
}

/**
 * DELETE /api/voice-clips/:id — delete a voice clip.
 */
async function deleteVoiceClip(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    await db.deleteVoiceClip(Number(req.params.id), clientId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /api/crm/send-voice — CRM agent sends a saved voice clip to a customer.
 * Body: { phone, clip_id }
 */
async function sendVoiceClip(req, res) {
  const clientId = resolveClientId(req);
  const { phone, clip_id } = req.body;
  if (!phone)   return res.status(400).json({ error: 'phone required' });
  if (!clip_id) return res.status(400).json({ error: 'clip_id required' });

  try {
    const clips = await db.getVoiceClips(clientId);
    const clip = clips.find(c => c.id === Number(clip_id));
    if (!clip) return res.status(404).json({ error: 'Voice clip not found' });

    const client = clientId ? await clientRouter.getClientById(clientId) : null;
    const wamid = await sendWhatsAppAudio(phone, clip.audio_url, client);
    await db.insertMessage(phone, `[Voice: ${clip.name}]`, 'bot', null, clientId, 'audio', clip.audio_url, wamid, null, { sentBy: req.user?.uid ?? null });
    res.json({ ok: true });
  } catch (e) {
    console.error('[VOICE-CLIP] send error:', e.message);
    res.status(500).json({ error: e?.response?.data?.error?.message || e.message });
  }
}

module.exports = {
  sendRecording, listVoiceClips, createVoiceClip, deleteVoiceClip, sendVoiceClip };
