'use strict';

const { pool, IS_PG } = require('./connection');

async function getVoiceClips(clientId) {
  if (!IS_PG) return [];
  const r = await pool.query(
    `SELECT id, name, trigger_keyword, audio_url, created_at FROM voice_clips
     WHERE client_id=$1 ORDER BY created_at DESC`,
    [clientId]
  );
  return r.rows;
}

async function getVoiceClipByKeyword(clientId, triggerKeyword) {
  if (!IS_PG) return null;
  const r = await pool.query(
    `SELECT id, name, trigger_keyword, audio_url FROM voice_clips
     WHERE client_id=$1 AND trigger_keyword=$2 LIMIT 1`,
    [clientId, triggerKeyword]
  );
  return r.rows[0] || null;
}

async function insertVoiceClip(clientId, name, triggerKeyword, audioUrl) {
  if (!IS_PG) return null;
  const r = await pool.query(
    `INSERT INTO voice_clips (client_id, name, trigger_keyword, audio_url)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [clientId, name, triggerKeyword, audioUrl]
  );
  return r.rows[0].id;
}

async function deleteVoiceClip(id, clientId) {
  if (!IS_PG) return;
  await pool.query(`DELETE FROM voice_clips WHERE id=$1 AND client_id=$2`, [id, clientId]);
}

module.exports = { getVoiceClips, getVoiceClipByKeyword, insertVoiceClip, deleteVoiceClip };
