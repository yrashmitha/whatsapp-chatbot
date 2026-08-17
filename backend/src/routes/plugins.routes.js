/**
 * @module routes/plugins.routes
 * @description Express router for plugin configuration and astro chart endpoints.
 */

'use strict';

const multer  = require('multer');
const router  = require('express').Router();
const jwtAuth = require('../middleware/jwtAuth');
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
router.post('/horoscope/ai-prepare/:orderId',     jwtAuth, aiPrepareHoroscope);
router.post('/horoscope/fetch-chart',             jwtAuth, fetchChartData);
router.post('/horoscope/generate',                jwtAuth, generateHoroscopeReading);
router.get('/horoscope/progress/:orderId',        jwtAuth, horoscopeProgress);
router.patch('/horoscope/sections/:orderId',         jwtAuth, updateHoroscopeSections);
router.patch('/horoscope/quantum-sections/:orderId',    jwtAuth, updateQuantumSections);
router.post('/horoscope/regenerate-quantum/:orderId',         jwtAuth, regenerateQuantumSections);
router.post('/horoscope/regenerate-quantum-section/:orderId',   jwtAuth, regenerateQuantumSection);
router.post('/horoscope/regenerate-section/:orderId',            jwtAuth, regenerateHoroscopeSectionHandler);
router.get('/horoscope/download/:orderId',        jwtAuth, downloadHoroscope);
router.get('/horoscope/download-pdf/:orderId',    jwtAuth, downloadHoroscopePdf);
router.get('/horoscope/download-quantum-docx/:orderId', jwtAuth, downloadQuantumDocx);
router.get('/horoscope/download-quantum-pdf/:orderId',  jwtAuth, downloadQuantumPdf);
router.patch('/horoscope/wa-message/:orderId',           jwtAuth, saveWaMessageHandler);
router.post('/horoscope/generate-wa-message/:orderId',  jwtAuth, generateWaMessageHandler);
router.post('/horoscope/generate-marriage/:orderId',            jwtAuth, generateMarriageHandler);
router.post('/horoscope/regenerate-marriage-section/:orderId',  jwtAuth, regenerateMarriageSectionHandler);
router.patch('/horoscope/marriage-sections/:orderId',           jwtAuth, updateMarriageSections);
router.get('/horoscope/download-marriage-docx/:orderId',        jwtAuth, downloadMarriageDocx);
router.get('/horoscope/download-marriage-pdf/:orderId',         jwtAuth, downloadMarriagePdf);
router.post('/horoscope/generate-marriage-wa/:orderId',         jwtAuth, generateMarriageWaHandler);
router.patch('/horoscope/marriage-wa/:orderId',                 jwtAuth, saveMarriageWaHandler);
router.post('/horoscope/ai-prepare-match/:orderId',              jwtAuth, aiPrepareMatch);
router.patch('/horoscope/match-people/:orderId',                jwtAuth, saveMatchPeople);
router.post('/horoscope/generate-match/:orderId',               jwtAuth, generateMatchHandler);
router.post('/horoscope/regenerate-match-section/:orderId',     jwtAuth, regenerateMatchSectionHandler);
router.patch('/horoscope/match-sections/:orderId',              jwtAuth, updateMatchSections);
router.get('/horoscope/download-match-docx/:orderId',           jwtAuth, downloadMatchDocx);
router.get('/horoscope/download-match-pdf/:orderId',            jwtAuth, downloadMatchPdf);
// Full 20-Porondam report (data comes from the pahantharu_web site) — docx + PDF
router.get('/horoscope/download-porondam-docx/:orderId',        jwtAuth, downloadPorondamDocx);
router.get('/horoscope/download-porondam-pdf/:orderId',         jwtAuth, downloadPorondamPdf);
router.post('/follow-up',                               jwtAuth, generateFollowUpMessage);
router.get('/meta/recent-events',                       jwtAuth, recentMetaEvents);
router.post('/meta/sync-audience',                      jwtAuth, syncMetaAudience);
router.post('/meta/create-audience',                    jwtAuth, createMetaAudience);

module.exports = router;
