/**
 * @module routes/index
 * @description Mounts all application route groups onto the Express app instance.
 * Call mountRoutes(app) once from app.js after middleware setup.
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const authRoutes       = require('./auth.routes');
const chatRoutes       = require('./chat.routes');
const webhookRoutes    = require('./webhook.routes');
const catalogRoutes    = require('./catalog.routes');
const customerRoutes   = require('./customers.routes');   // mounted at /api — owns /api/customers, /api/messages, /api/send, /api/clients
const orderRoutes      = require('./orders.routes');
const productRoutes    = require('./products.routes');
const attributeRoutes  = require('./attributes.routes');
const knowledgeRoutes  = require('./knowledge.routes');
const mediaRoutes      = require('./media.routes');
const addonRoutes      = require('./addons.routes');      // mounted at /api — owns /api/addons, /api/crm
const pluginRoutes     = require('./plugins.routes');
const settingsRoutes   = require('./settings.routes');
const adminRoutes      = require('./admin.routes');

const jwtAuth = require('../middleware/jwtAuth');
const { upload } = require('../config/multer');
const { uploadImage } = require('../controllers/products.controller');

/**
 * Mount all route groups onto the Express app.
 *
 * Route prefix mapping:
 *   /auth              → authRoutes
 *   /chat              → chatRoutes
 *   /webhook           → webhookRoutes
 *   /api/catalog       → catalogRoutes
 *   /api               → customerRoutes  (/api/customers, /api/messages, /api/send, /api/clients)
 *   /api               → addonRoutes     (/api/addons, /api/crm)
 *   /api/orders        → orderRoutes
 *   /api/products      → productRoutes
 *   /api/attributes    → attributeRoutes
 *   /api/upload-image  → uploadImage (inline)
 *   /api/knowledge     → knowledgeRoutes
 *   /api/media         → mediaRoutes
 *   /api/plugins       → pluginRoutes
 *   /api/settings      → settingsRoutes
 *   /admin             → adminRoutes
 *
 * @param {import('express').Application} app - The Express application instance.
 * @returns {void}
 */
function mountRoutes(app) {
  // Public / unauthenticated routes
  app.use('/auth',             authRoutes);
  app.use('/chat',             chatRoutes);
  app.use('/webhook',          webhookRoutes);
  app.use('/api/catalog',      catalogRoutes);

  // Customer, message, client routes (all sub-paths defined inside the router)
  app.use('/api',              customerRoutes);

  // Addon + CRM routes (all sub-paths defined inside the router)
  app.use('/api',              addonRoutes);

  // Standard scoped API routes
  app.use('/api/orders',       orderRoutes);
  app.use('/api/products',     productRoutes);
  app.use('/api/attributes',   attributeRoutes);
  app.use('/api/knowledge',    knowledgeRoutes);
  app.use('/api/media',        mediaRoutes);
  app.use('/api/plugins',      pluginRoutes);
  app.use('/api/settings',     settingsRoutes);

  // Standalone endpoint: POST /api/upload-image (Cloudinary product image upload)
  app.post('/api/upload-image', jwtAuth, upload.single('image'), uploadImage);

  // Legacy admin routes (adminAuth, no JWT)
  app.use('/admin',            adminRoutes);

  // SPA fallback — serve React app for all non-API, non-static routes
  app.get('*', (req, res) => {
    const isBackendRoute =
      req.path.startsWith('/api') ||
      req.path.startsWith('/admin') ||
      req.path.startsWith('/auth') ||
      req.path.startsWith('/webhook') ||
      req.path.startsWith('/legacy');
    if (isBackendRoute) return res.status(404).json({ error: 'Not found' });
    // Don't serve HTML for asset requests — they must exist as static files
    if (path.extname(req.path)) return res.status(404).send('Not found');
    const indexFile = path.join(__dirname, '../../../frontend/dist/index.html');
    if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
    res.status(503).send('App not built');
  });
}

module.exports = { mountRoutes };
