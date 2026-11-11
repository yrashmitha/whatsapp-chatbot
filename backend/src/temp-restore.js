'use strict';
// TEMPORARY: one-off route to restore /data/uploads after a volume wipe.
// Key = sha256 of the DB password (no new env var needed). Never overwrites.
// Remove this file and its mount in app.js once the restore is done.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { UPLOADS_DIR } = require('./config/env');

module.exports = function mountTempRestore(app) {
  const key = crypto.createHash('sha256').update((() => { try { return decodeURIComponent(new URL(process.env.DATABASE_URL).password); } catch { return 'none-' + Math.random(); } })()).digest('hex');
  app.put('/__restore/:name', express.raw({ type: '*/*', limit: '40mb' }), async (req, res) => {
    const given = String(req.get('x-restore-key') || '');
    if (given.length !== key.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key))) {
      return res.status(404).end();
    }
    const name = path.basename(req.params.name);
    if (!name || name.startsWith('.') || !Buffer.isBuffer(req.body)) return res.status(400).end();
    try {
      await fs.promises.mkdir(UPLOADS_DIR, { recursive: true });
      await fs.promises.writeFile(path.join(UPLOADS_DIR, name), req.body, { flag: 'wx' });
      res.json({ ok: true });
    } catch (e) {
      res.status(e.code === 'EEXIST' ? 200 : 500).json({ ok: e.code === 'EEXIST', skipped: e.code === 'EEXIST' });
    }
  });
};
