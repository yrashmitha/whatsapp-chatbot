'use strict';

const { pool, db, IS_PG } = require('./connection');

const COLS = 'id, title, text, category, sort_order, created_at';

async function getQuickReplies(clientId) {
  if (IS_PG) {
    const r = await pool.query(
      `SELECT ${COLS} FROM quick_replies WHERE client_id=$1 ORDER BY sort_order, id`,
      [clientId]
    );
    return r.rows;
  } else {
    return db.prepare(`SELECT ${COLS} FROM quick_replies WHERE client_id=? ORDER BY sort_order, id`).all(clientId);
  }
}

async function createQuickReply(clientId, title, text, category = '') {
  if (IS_PG) {
    const r = await pool.query(
      `INSERT INTO quick_replies (client_id, title, text, category) VALUES ($1, $2, $3, $4) RETURNING ${COLS}`,
      [clientId, title, text, category]
    );
    return r.rows[0];
  } else {
    const info = db.prepare(`INSERT INTO quick_replies (client_id, title, text, category) VALUES (?, ?, ?, ?)`).run(clientId, title, text, category);
    return db.prepare(`SELECT ${COLS} FROM quick_replies WHERE id=?`).get(info.lastInsertRowid);
  }
}

async function updateQuickReply(clientId, id, title, text, category = '') {
  if (IS_PG) {
    const r = await pool.query(
      `UPDATE quick_replies SET title=$1, text=$2, category=$3 WHERE id=$4 AND client_id=$5 RETURNING ${COLS}`,
      [title, text, category, id, clientId]
    );
    return r.rows[0] || null;
  } else {
    db.prepare(`UPDATE quick_replies SET title=?, text=?, category=? WHERE id=? AND client_id=?`).run(title, text, category, id, clientId);
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

module.exports = { getQuickReplies, createQuickReply, updateQuickReply, deleteQuickReply };
