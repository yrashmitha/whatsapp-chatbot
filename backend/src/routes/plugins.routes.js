/**
 * @module routes/plugins.routes
 * @description Express router for plugin configuration and astro chart endpoints.
 */

'use strict';

const multer  = require('multer');
const router  = require('express').Router();
const jwtAuth = require('../middleware/jwtAuth');
const orderScope = require('../middleware/orderScope');
const {
  getPluginConfig,
  updatePluginConfig,
  getPluginCustomerData,
  generateAstroChart,
  analyzeAuraImage,
  aiPrepareHoroscope,
  fetchChartData,
  generateHoroscopeReading,
  horoscopeProgress,
  updateHoroscopeSections,
  updateQuantumSections,
  regenerateQuantumSections,
  regenerateQuantumSection,
  regenerateHoroscopeSectionHandler,
  saveWaMessageHandler,
  generateWaMessageHandler,
  downloadQuantumDocx,
  downloadHoroscope,
  downloadHoroscopePdf,
  downloadQuantumPdf,
  generateMarriageHandler,
  regenerateMarriageSectionHandler,
  updateMarriageSections,
  downloadMarriageDocx,
  downloadMarriagePdf,
  generateMarriageWaHandler,
  saveMarriageWaHandler,
  aiPrepareMatch,
  saveMatchPeople,
  generateMatchHandler,
  regenerateMatchSectionHandler,
  updateMatchSections,
  downloadMatchDocx,
  downloadMatchPdf,
  downloadPorondamDocx,
  downloadPorondamPdf,
  generateFollowUpMessage,
  syncMetaAudience,
  createMetaAudience,
  recentMetaEvents,
} = require('../controllers/plugins.controller');

// Memory-storage upload for aura selfie (max 10 MB, images only)
const auraUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

router.get('/:pluginId/config',                   jwtAuth, getPluginConfig);
router.put('/:pluginId/config',                   jwtAuth, updatePluginConfig);
router.get('/:pluginId/customer-data/:phone',     jwtAuth, getPluginCustomerData);
router.post('/astro-chart',                       jwtAuth, generateAstroChart);
router.post('/horoscope/analyze-aura',            jwtAuth, auraUpload.single('image'), analyzeAuraImage);
router.post('/horoscope/ai-prepare/:orderId',     jwtAuth, orderScope, aiPrepareHoroscope);
router.post('/horoscope/fetch-chart',             jwtAuth, orderScope, fetchChartData);
router.post('/horoscope/generate',                jwtAuth, orderScope, generateHoroscopeReading);
router.get('/horoscope/progress/:orderId',        jwtAuth, orderScope, horoscopeProgress);
router.patch('/horoscope/sections/:orderId',         jwtAuth, orderScope, updateHoroscopeSections);
router.patch('/horoscope/quantum-sections/:orderId',    jwtAuth, orderScope, updateQuantumSections);
router.post('/horoscope/regenerate-quantum/:orderId',         jwtAuth, orderScope, regenerateQuantumSections);
router.post('/horoscope/regenerate-quantum-section/:orderId',   jwtAuth, orderScope, regenerateQuantumSection);
router.post('/horoscope/regenerate-section/:orderId',            jwtAuth, orderScope, regenerateHoroscopeSectionHandler);
router.get('/horoscope/download/:orderId',        jwtAuth, orderScope, downloadHoroscope);
router.get('/horoscope/download-pdf/:orderId',    jwtAuth, orderScope, downloadHoroscopePdf);
router.get('/horoscope/download-quantum-docx/:orderId', jwtAuth, orderScope, downloadQuantumDocx);
router.get('/horoscope/download-quantum-pdf/:orderId',  jwtAuth, orderScope, downloadQuantumPdf);
router.patch('/horoscope/wa-message/:orderId',           jwtAuth, orderScope, saveWaMessageHandler);
router.post('/horoscope/generate-wa-message/:orderId',  jwtAuth, orderScope, generateWaMessageHandler);
router.post('/horoscope/generate-marriage/:orderId',            jwtAuth, orderScope, generateMarriageHandler);
router.post('/horoscope/regenerate-marriage-section/:orderId',  jwtAuth, orderScope, regenerateMarriageSectionHandler);
router.patch('/horoscope/marriage-sections/:orderId',           jwtAuth, orderScope, updateMarriageSections);
router.get('/horoscope/download-marriage-docx/:orderId',        jwtAuth, orderScope, downloadMarriageDocx);
router.get('/horoscope/download-marriage-pdf/:orderId',         jwtAuth, orderScope, downloadMarriagePdf);
router.post('/horoscope/generate-marriage-wa/:orderId',         jwtAuth, orderScope, generateMarriageWaHandler);
router.patch('/horoscope/marriage-wa/:orderId',                 jwtAuth, orderScope, saveMarriageWaHandler);
router.post('/horoscope/ai-prepare-match/:orderId',              jwtAuth, orderScope, aiPrepareMatch);
router.patch('/horoscope/match-people/:orderId',                jwtAuth, orderScope, saveMatchPeople);
router.post('/horoscope/generate-match/:orderId',               jwtAuth, orderScope, generateMatchHandler);
router.post('/horoscope/regenerate-match-section/:orderId',     jwtAuth, orderScope, regenerateMatchSectionHandler);
router.patch('/horoscope/match-sections/:orderId',              jwtAuth, orderScope, updateMatchSections);
router.get('/horoscope/download-match-docx/:orderId',           jwtAuth, orderScope, downloadMatchDocx);
router.get('/horoscope/download-match-pdf/:orderId',            jwtAuth, orderScope, downloadMatchPdf);
// Full 20-Porondam report (data comes from the pahantharu_web site) — docx + PDF
router.get('/horoscope/download-porondam-docx/:orderId',        jwtAuth, orderScope, downloadPorondamDocx);
router.get('/horoscope/download-porondam-pdf/:orderId',         jwtAuth, orderScope, downloadPorondamPdf);
router.post('/follow-up',                               jwtAuth, generateFollowUpMessage);
router.get('/meta/recent-events',                       jwtAuth, recentMetaEvents);
router.post('/meta/sync-audience',                      jwtAuth, syncMetaAudience);
router.post('/meta/create-audience',                    jwtAuth, createMetaAudience);

module.exports = router;
