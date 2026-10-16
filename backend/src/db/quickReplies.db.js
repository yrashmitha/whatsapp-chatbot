'use strict';

const { pool, db, IS_PG } = require('./connection');

const COLS = 'id, title, text, category, sort_order, created_at, strategy';

/** 'A' or 'B' stay; anything else means shared (NULL). */
function arm(v) { return v === 'A' || v === 'B' ? v : null; }

/**
 * Quick replies for a client.
 *
 * With no strategy, every row comes back (the editor needs to see them all,
 * including the ones tagged to one arm). With 'A' or 'B', only what that arm
 * would send: shared rows plus its own, where its own replaces a shared row of
 * the same title. That is what an operator in a chat running that strategy
 * should be offered.
 */
async function getQuickReplies(clientId, strategy) {
  const rows = IS_PG
    ? (await pool.query(`SELECT ${COLS} FROM quick_replies WHERE client_id=$1 ORDER BY sort_order, id`, [clientId])).rows
    : db.prepare(`SELECT ${COLS} FROM quick_replies WHERE client_id=? ORDER BY sort_order, id`).all(clientId);
  const want = arm(strategy);
  if (!want) return rows;
  const byTitle = new Map();
  for (const r of rows) {
    if (r.strategy && r.strategy !== want) continue;
    const k = r.title.toLowerCase();
    const prev = byTitle.get(k);
    if (!prev || r.strategy === want) byTitle.set(k, r);
  }
  return rows.filter(r => byTitle.get(r.title.toLowerCase()) === r);
}

async function createQuickReply(clientId, title, text, category = '', strategy = null) {
  if (IS_PG) {
    const r = await pool.query(
      `INSERT INTO quick_replies (client_id, title, text, category, strategy) VALUES ($1, $2, $3, $4, $5) RETURNING ${COLS}`,
      [clientId, title, text, category, arm(strategy)]
    );
    return r.rows[0];
  } else {
    const info = db.prepare(`INSERT INTO quick_replies (client_id, title, text, category, strategy) VALUES (?, ?, ?, ?, ?)`).run(clientId, title, text, category, arm(strategy));
    return db.prepare(`SELECT ${COLS} FROM quick_replies WHERE id=?`).get(info.lastInsertRowid);
  }
}

async function updateQuickReply(clientId, id, title, text, category = '', strategy) {
  // strategy undefined = leave as is; null/'' = shared; 'A'/'B' = that arm only.
  const touch = strategy !== undefined;
  if (IS_PG) {
    const r = await pool.query(
      `UPDATE quick_replies SET title=$1, text=$2, category=$3,
              strategy = CASE WHEN $6 THEN $7 ELSE strategy END
        WHERE id=$4 AND client_id=$5 RETURNING ${COLS}`,
      [title, text, category, id, clientId, touch, arm(strategy)]
    );
    return r.rows[0] || null;
  } else {
    db.prepare(`UPDATE quick_replies SET title=?, text=?, category=?, strategy = CASE WHEN ? THEN ? ELSE strategy END WHERE id=? AND client_id=?`)
      .run(title, text, category, touch ? 1 : 0, arm(strategy), id, clientId);
    return db.prepare(`SELECT ${COLS} FROM quick_replies WHERE id=? AND client_id=?`).get(id, clientId) || null;
  }
}

async function deleteQuickReply(clientId, id) {
  if (IS_PG) {
    await pool.query(`DELETE FROM quick_replies WHERE id=$1 AND client_id=$2`, [id, clientId]);
  } else {
    db.prepare(`DELETE FROM quick_replies WHERE id=? AND client_id=?`).run(id, clientId);
  }
}

/**
 * Make a copy of a quick reply that belongs to one strategy only, with the same
 * title so that arm sends the copy instead of the original. Returns the
 * existing copy if that arm already has one.
 */
async function forkQuickReply(clientId, id, toStrategy) {
  const to = arm(toStrategy);
  if (!to) return null;
  const src = IS_PG
    ? (await pool.query(`SELECT ${COLS} FROM quick_replies WHERE id=$1 AND client_id=$2`, [id, clientId])).rows[0]
    : db.prepare(`SELECT ${COLS} FROM quick_replies WHERE id=? AND client_id=?`).get(id, clientId);
  if (!src) return null;
  const have = IS_PG
    ? (await pool.query(`SELECT ${COLS} FROM quick_replies WHERE client_id=$1 AND LOWER(title)=LOWER($2) AND strategy=$3 LIMIT 1`, [clientId, src.title, to])).rows[0]
    : db.prepare(`SELECT ${COLS} FROM quick_replies WHERE client_id=? AND LOWER(title)=LOWER(?) AND strategy=? LIMIT 1`).get(clientId, src.title, to);
  if (have) return have;
  return createQuickReply(clientId, src.title, src.text, src.category || '', to);
}

module.exports = { getQuickReplies, createQuickReply, updateQuickReply, deleteQuickReply, forkQuickReply };
