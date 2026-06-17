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

module.exports = router;
