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
const menusRoutes      = require('./menus.routes');
const followUpsRoutes  = require('./followUps.routes');
const leadsRoutes      = require('./leads.routes');       // mounted at /api — owns /api/leads, /api/customers/:phone/calls|lead-status
const crmUsersRoutes   = require('./crmUsers.routes');
const horoscopeQaRoutes = require('./horoscopeQa.routes');
const testChatRoutes    = require('./testChat.routes');
const summaryRoutes      = require('./summary.routes');
const adminRoutes        = require('./admin.routes');
const quickRepliesRoutes = require('./quickReplies.routes');
const callsRoutes        = require('./calls.routes');
const voiceClipsRoutes   = require('./voice_clips.routes');
const { publicRouter: consultPublic, adminRouter: consultAdmin } = require('./consult.routes');
const publicRoutes     = require('./public.routes');   // external FE channel (API-key), mounted at /public
const deliveryRoutes   = require('./delivery.routes'); // report-delivery channel for www.puranajothirwedaya.com (X-Delivery-Key), mounted at /internal/delivery

const jwtAuth = require('../middleware/jwtAuth');
const { upload } = require('../config/multer');
const { uploadImage } = require('../controllers/products.controller');
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

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
 *   /api/menus         → menusRoutes
 *   /api/follow-ups    → followUpsRoutes
 *   /api/crm-users     → crmUsersRoutes
 *   /api/horoscope-qa  → horoscopeQaRoutes
 *   /api/test-chat     → testChatRoutes
 *   /admin             → adminRoutes
 *
 * @param {import('express').Application} app - The Express application instance.
 * @returns {void}
 */
function mountRoutes(app) {
  // Public / unauthenticated routes
  app.use('/auth',             loginLimiter, authRoutes);
  app.use('/chat',             chatRoutes);
  app.use('/webhook',          webhookLimiter, webhookRoutes);
  app.use('/api/catalog',      catalogRoutes);
  app.use('/public',           publicRoutes);
  app.use('/internal/delivery', deliveryRoutes);
  app.use('/consult',          consultPublic);
  app.use('/api/consult',      jwtAuth, consultAdmin);

  // Customer, message, client routes (all sub-paths defined inside the router)
  app.use('/api',              customerRoutes);

  // Addon + CRM routes (all sub-paths defined inside the router)
  app.use('/api',              addonRoutes);

  // Lead quality + call log
  app.use('/api',              leadsRoutes);

  // Standard scoped API routes
  app.use('/api/orders',       orderRoutes);
  app.use('/api/products',     productRoutes);
  app.use('/api/attributes',   attributeRoutes);
  app.use('/api/knowledge',    knowledgeRoutes);
  app.use('/api/media',        mediaRoutes);
  app.use('/api/plugins',      pluginRoutes);
  app.use('/api/settings',     settingsRoutes);
  app.use('/api/menus',        menusRoutes);
  app.use('/api/follow-ups',   followUpsRoutes);
  app.use('/api/crm-users',   crmUsersRoutes);
  app.use('/api/horoscope-qa', horoscopeQaRoutes);
  app.use('/api/test-chat',    testChatRoutes);
  app.use('/api/summary',        summaryRoutes);
  app.use('/api/quick-replies',  quickRepliesRoutes);
  app.use('/api/calls',          callsRoutes);
  app.use('/api/voice-clips',    voiceClipsRoutes);

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
      req.path.startsWith('/public') ||
      req.path.startsWith('/internal') ||
      req.path.startsWith('/consult') ||
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
