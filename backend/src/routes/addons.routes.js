/**
 * @module routes/addons.routes
 * @description Express router for addon management and CRM media send endpoints.
 * Mounted at /api — handles /api/addons/*, /api/crm/*.
 */

'use strict';

const router        = require('express').Router();
const requirePermission = require('../middleware/requirePermission');
const jwtAuth       = require('../middleware/jwtAuth');
const orderScope    = require('../middleware/orderScope');
const { uploadMedia } = require('../config/multer');
const {
  addonCatalog,
  listAddons,
  toggleAddon,
  getAddonsStatus,
  sendMedia,
  reextractMedia,
  triggerTarotReading,
  listLinkableTarot,
  aiFillOrderDraft,
  aiPrepareTarot,
  fetchTarotChart,
  updateTarotSections,
  downloadTarotDocx,
  downloadTarotPdfByOrder,
  downloadTarotPdf,
} = require('../controllers/addons.controller');

// Addon catalog (any authenticated user) — GET /api/addons/catalog
// Declared before /addons so the literal path is not shadowed.
router.get('/addons/catalog',      jwtAuth, addonCatalog);

// Addon management (superadmin only) — GET /api/addons, PUT /api/addons/:addonId
router.get('/addons',              jwtAuth, requirePermission('settings.plugins'), listAddons);
router.put('/addons/:addonId',     jwtAuth, requirePermission('settings.plugins'), toggleAddon);

// CRM status check — GET /api/crm/addons-status
router.get('/crm/addons-status',   jwtAuth, getAddonsStatus);

// CRM agent send media — POST /api/crm/send-media
router.post('/crm/send-media',     jwtAuth, requirePermission('chat.send_media'), uploadMedia.single('file'), sendMedia);

// Re-run extraction on a customer's stored media — POST /api/crm/media/reextract  { phone }
router.post('/crm/media/reextract', jwtAuth, requirePermission('chat.read'), reextractMedia);

// Tarot reading — POST /api/crm/tarot-reading (trigger; background when order_id present)
router.post('/crm/tarot-reading',                        jwtAuth, requirePermission('ai.generate_report'), orderScope, triggerTarotReading);
// Earlier tarot orders of this customer, for chaining — GET /api/crm/tarot-reading/linkable/:orderId
router.get('/crm/tarot-reading/linkable/:orderId',       jwtAuth, requirePermission('ai.generate_report'), orderScope, listLinkableTarot);
// AI-suggest Create Order form values from the chat — POST /api/crm/orders/ai-fill-draft
router.post('/crm/orders/ai-fill-draft',                 jwtAuth, requirePermission('ai.fill'), aiFillOrderDraft);
// AI-fill the tarot request from the chat — POST /api/crm/tarot-reading/ai-prepare/:orderId
router.post('/crm/tarot-reading/ai-prepare/:orderId',   jwtAuth, requirePermission('ai.fill'), orderScope, aiPrepareTarot);
// Fetch + save the birth chart, return lagna — POST /api/crm/tarot-reading/fetch-chart/:orderId
router.post('/crm/tarot-reading/fetch-chart/:orderId',  jwtAuth, requirePermission('ai.astro_chart'), orderScope, fetchTarotChart);
// Update reading text/cards — PATCH /api/crm/tarot-reading/sections/:orderId
router.patch('/crm/tarot-reading/sections/:orderId',     jwtAuth, requirePermission('reports.edit'), orderScope, updateTarotSections);
// Download DOCX — GET /api/crm/tarot-reading/download/:orderId
router.get('/crm/tarot-reading/download/:orderId',       jwtAuth, requirePermission('reports.download'), orderScope, downloadTarotDocx);
// Download PDF  — GET /api/crm/tarot-reading/download-pdf/:orderId
router.get('/crm/tarot-reading/download-pdf/:orderId',   jwtAuth, requirePermission('reports.download'), orderScope, downloadTarotPdfByOrder);
// Legacy POST PDF (used by chat TarotModal)
router.post('/crm/tarot-reading/pdf',                    jwtAuth, requirePermission('reports.download'), orderScope, downloadTarotPdf);

module.exports = router;
