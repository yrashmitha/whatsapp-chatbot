/**
 * @module routes/addons.routes
 * @description Express router for addon management and CRM media send endpoints.
 * Mounted at /api — handles /api/addons/*, /api/crm/*.
 */

'use strict';

const router        = require('express').Router();
const jwtAuth       = require('../middleware/jwtAuth');
const orderScope    = require('../middleware/orderScope');
const { uploadMedia } = require('../config/multer');
const {
  addonCatalog,
  listAddons,
  toggleAddon,
  getAddonsStatus,
  sendMedia,
  triggerTarotReading,
  updateTarotSections,
  downloadTarotDocx,
  downloadTarotPdfByOrder,
  downloadTarotPdf,
} = require('../controllers/addons.controller');

// Addon catalog (any authenticated user) — GET /api/addons/catalog
// Declared before /addons so the literal path is not shadowed.
router.get('/addons/catalog',      jwtAuth, addonCatalog);

// Addon management (superadmin only) — GET /api/addons, PUT /api/addons/:addonId
router.get('/addons',              jwtAuth, listAddons);
router.put('/addons/:addonId',     jwtAuth, toggleAddon);

// CRM status check — GET /api/crm/addons-status
router.get('/crm/addons-status',   jwtAuth, getAddonsStatus);

// CRM agent send media — POST /api/crm/send-media
router.post('/crm/send-media',     jwtAuth, uploadMedia.single('file'), sendMedia);

// Tarot reading — POST /api/crm/tarot-reading (trigger; background when order_id present)
router.post('/crm/tarot-reading',                        jwtAuth, orderScope, triggerTarotReading);
// Update reading text/cards — PATCH /api/crm/tarot-reading/sections/:orderId
router.patch('/crm/tarot-reading/sections/:orderId',     jwtAuth, orderScope, updateTarotSections);
// Download DOCX — GET /api/crm/tarot-reading/download/:orderId
router.get('/crm/tarot-reading/download/:orderId',       jwtAuth, orderScope, downloadTarotDocx);
// Download PDF  — GET /api/crm/tarot-reading/download-pdf/:orderId
router.get('/crm/tarot-reading/download-pdf/:orderId',   jwtAuth, orderScope, downloadTarotPdfByOrder);
// Legacy POST PDF (used by chat TarotModal)
router.post('/crm/tarot-reading/pdf',                    jwtAuth, orderScope, downloadTarotPdf);

module.exports = router;
