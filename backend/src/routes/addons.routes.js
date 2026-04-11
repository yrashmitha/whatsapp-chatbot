/**
 * @module routes/addons.routes
 * @description Express router for addon management and CRM media send endpoints.
 * Mounted at /api — handles /api/addons/*, /api/crm/*.
 */

'use strict';

const router        = require('express').Router();
const jwtAuth       = require('../middleware/jwtAuth');
const { uploadMedia } = require('../config/multer');
const {
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

// Addon management (superadmin only) — GET /api/addons, PUT /api/addons/:addonId
router.get('/addons',              jwtAuth, listAddons);
router.put('/addons/:addonId',     jwtAuth, toggleAddon);

// CRM status check — GET /api/crm/addons-status
router.get('/crm/addons-status',   jwtAuth, getAddonsStatus);

// CRM agent send media — POST /api/crm/send-media
router.post('/crm/send-media',     jwtAuth, uploadMedia.single('file'), sendMedia);

// Tarot reading — POST /api/crm/tarot-reading (trigger; background when order_id present)
router.post('/crm/tarot-reading',                        jwtAuth, triggerTarotReading);
// Update reading text/cards — PATCH /api/crm/tarot-reading/sections/:orderId
router.patch('/crm/tarot-reading/sections/:orderId',     jwtAuth, updateTarotSections);
// Download DOCX — GET /api/crm/tarot-reading/download/:orderId
router.get('/crm/tarot-reading/download/:orderId',       jwtAuth, downloadTarotDocx);
// Download PDF  — GET /api/crm/tarot-reading/download-pdf/:orderId
router.get('/crm/tarot-reading/download-pdf/:orderId',   jwtAuth, downloadTarotPdfByOrder);
// Legacy POST PDF (used by chat TarotModal)
router.post('/crm/tarot-reading/pdf',                    jwtAuth, downloadTarotPdf);

module.exports = router;
