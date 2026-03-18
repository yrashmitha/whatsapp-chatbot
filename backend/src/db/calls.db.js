'use strict';

const { pool, IS_PG } = require('./connection');

async function insertCall(callSid, clientId, callerPhone, calledPhone) {
  if (!IS_PG) return;
  await pool.query(
    `INSERT INTO calls (call_sid, client_id, caller_phone, called_phone)
     VALUES ($1, $2, $3, $4) ON CONFLICT (call_sid) DO NOTHING`,
    [callSid, clientId, callerPhone, calledPhone]
  );
}

async function appendTranscriptTurn(callSid, speaker, text) {
  if (!IS_PG) return;
  const turn = JSON.stringify({ speaker, text, ts: new Date().toISOString() });
  await pool.query(
    `UPDATE calls SET transcript = transcript || $1::jsonb WHERE call_sid = $2`,
    [`[${turn}]`, callSid]
  );
}

async function updateCallStatus(callSid, status, durationSeconds, endedAt) {
  if (!IS_PG) return;
  await pool.query(
    `UPDATE calls SET status=$1, duration_seconds=$2, ended_at=$3 WHERE call_sid=$4`,
    [status, durationSeconds || null, endedAt || null, callSid]
  );
}

async function updateCallSummary(callSid, summary) {
  if (!IS_PG) return;
  await pool.query(`UPDATE calls SET ai_summary=$1 WHERE call_sid=$2`, [summary, callSid]);
}

async function listCalls(clientId, { page = 1, limit = 20, search = '', status = '', dateFrom = '', dateTo = '' } = {}) {
  if (!IS_PG) return { calls: [], total: 0 };
  const offset = (page - 1) * limit;
  const conditions = ['client_id=$1'];
  const params = [clientId];
  if (search)   { params.push(`%${search}%`);  conditions.push(`caller_phone ILIKE $${params.length}`); }
  if (status)   { params.push(status);          conditions.push(`status=$${params.length}`); }
  if (dateFrom) { params.push(dateFrom);        conditions.push(`created_at >= $${params.length}::date`); }
  if (dateTo)   { params.push(dateTo);          conditions.push(`created_at < ($${params.length}::date + INTERVAL '1 day')`); }

  const where = conditions.join(' AND ');
  const [dataRes, countRes] = await Promise.all([
    pool.query(
      `SELECT id, call_sid, caller_phone, called_phone, status, duration_seconds, ai_summary, started_at, ended_at, created_at
       FROM calls WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM calls WHERE ${where}`, params),
  ]);
  return { calls: dataRes.rows, total: countRes.rows[0].total };
}

async function getCall(callSid, clientId) {
  if (!IS_PG) return null;
  const r = await pool.query(
    `SELECT * FROM calls WHERE call_sid=$1 AND client_id=$2`,
    [callSid, clientId]
  );
  return r.rows[0] || null;
}

module.exports = { insertCall, appendTranscriptTurn, updateCallStatus, updateCallSummary, listCalls, getCall };
