/**
 * @module app
 * @description New entry point for the WhatsApp chatbot backend.
 *
 * Wiring-only file: sets up Express, mounts middleware and routes,
 * starts the HTTP listener immediately (Railway health check), then
 * initialises the database and background workers in the background.
 */

'use strict';

require('dotenv').config();

const express = require('express');
const helmet  = require('helmet');
const path    = require('path');
const fs      = require('fs');
const bcrypt  = require('bcryptjs');

const db                 = require('./src/db');
const { PORT, UPLOADS_DIR } = require('./src/config/env');
const { mountRoutes }    = require('./src/routes');
const { uploadTemplateImages } = require('./src/services/whatsapp');
const { startRetryWorker }     = require('./src/workers/retryWorker');
const { startEviction }        = require('./src/workers/sessionManager');
const { embedText, productToText } = require('./src/services/embedder');

const app = express();

// Trust Railway's reverse proxy so rate limiting uses real client IP
app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

// ── Body parsers ──────────────────────────────────────────────────────────────
// Preserve raw body for Meta webhook signature verification
app.use('/webhook', express.raw({ type: 'application/json' }), (req, _res, next) => {
  req.rawBody = req.body;
  try { req.body = JSON.parse(req.body); } catch { req.body = {}; }
  next();
});
app.use(express.json({ limit: '20mb' }));
// Twilio webhooks send application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));

// ── Request logger ────────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  console.log(`[HTTP] ${req.method} ${req.path}`);
  next();
});

// ── Static file serving ───────────────────────────────────────────────────────
const FRONTEND_DIST = path.join(__dirname, '../frontend/dist');
if (fs.existsSync(FRONTEND_DIST)) {
  // Hashed JS/CSS assets: cache for 1 year
  app.use('/assets', express.static(path.join(FRONTEND_DIST, 'assets'), {
    maxAge: '1y',
    immutable: true,
  }));
  // Everything else (including index.html): no cache so deploys are instant
  app.use(express.static(FRONTEND_DIST, { maxAge: 0, etag: false }));
  console.log('[STARTUP] Serving React frontend from', FRONTEND_DIST);
}
// Persistent volume for customer-uploaded files
app.use('/uploads', express.static(UPLOADS_DIR));
// Legacy HTML pages
app.use('/legacy', express.static(path.join(__dirname, 'public')));
// Template images (horoscope samples etc.)
app.use('/templates', express.static(path.join(__dirname, 'public', 'templates')));

// ── Routes ────────────────────────────────────────────────────────────────────
mountRoutes(app);

// ── SPA catch-all — serve index.html for any non-API GET ─────────────────────
if (fs.existsSync(FRONTEND_DIST)) {
  const INDEX_HTML = path.join(FRONTEND_DIST, 'index.html');
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/auth') ||
        req.path.startsWith('/webhook') || req.path.startsWith('/uploads') ||
        req.path.startsWith('/legacy') || req.path.startsWith('/templates')) {
      return next();
    }
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(INDEX_HTML);
  });
}

// ── Global error handler — never expose internal error details to clients ─────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message || err);
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

// ── Start listening immediately (Railway needs a fast health check) ───────────
const port = PORT || 3000;
app.listen(port, () => {
  console.log(`[STARTUP] Server running on port ${port}`);
  console.log(`[STARTUP] Database: ${db.IS_PG ? 'PostgreSQL' : 'SQLite (local)'}`);
});

// ── Background: DB init → seed → workers → backfill ──────────────────────────
db.init()
  .then(async () => {
    console.log('[DB] Initialized successfully');

    // Seed superadmin if first run
    if (db.IS_PG && process.env.SUPERADMIN_PASSWORD) {
      try {
        const existing = await db.pgQuery(`SELECT id FROM crm_users WHERE username='superadmin'`);
        if (existing.rows.length === 0) {
          const hash = await bcrypt.hash(process.env.SUPERADMIN_PASSWORD, 10);
          await db.pgQuery(
            `INSERT INTO crm_users (username, password_hash, role) VALUES ('superadmin', $1, 'superadmin')`,
            [hash]
          );
          console.log('[AUTH] Superadmin user created');
        }
      } catch (e) {
        console.warn('[AUTH] Superadmin seed failed:', e.message);
      }
    }

    // Upload template images to WhatsApp media cache
    await uploadTemplateImages();

    // Start background session eviction (2-hour TTL, 30-min interval)
    startEviction();

    // Start message retry worker (polls every 2 minutes)
    startRetryWorker();

    // Backfill missing product embeddings (non-blocking)
    if (db.IS_PG) {
      db.pgQuery(
        `SELECT id, name, description, category, subcategory, sku, attributes
         FROM client_products WHERE active = TRUE AND embedding IS NULL`
      )
        .then(async ({ rows }) => {
          if (!rows.length) return;
          console.log(`[EMBED] Backfilling ${rows.length} products...`);
          for (const p of rows) {
            try {
              const emb = await embedText(productToText(p));
              await db.saveProductEmbedding(p.id, emb);
              console.log(`[EMBED] Saved embedding for: ${p.name}`);
            } catch (e) {
              console.warn(`[EMBED] Failed for product ${p.id}:`, e.message);
            }
          }
          console.log('[EMBED] Backfill done.');
        })
        .catch(e => console.warn('[EMBED] Backfill error:', e.message));
    }
  })
  .catch(err => {
    console.error('[STARTUP] DB init FAILED:', err.message || err);
    console.error('[STARTUP] Full error:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
    process.exit(1);
  });
