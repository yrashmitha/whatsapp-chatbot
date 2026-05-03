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
  generateHoroscopeReading,
  updateHoroscopeSections,
  updateQuantumSections,
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
router.post('/horoscope/generate',                jwtAuth, generateHoroscopeReading);
router.patch('/horoscope/sections/:orderId',         jwtAuth, updateHoroscopeSections);
router.patch('/horoscope/quantum-sections/:orderId', jwtAuth, updateQuantumSections);
router.get('/horoscope/download/:orderId',        jwtAuth, downloadHoroscope);
router.get('/horoscope/download-pdf/:orderId',    jwtAuth, downloadHoroscopePdf);
router.get('/horoscope/download-quantum-pdf/:orderId', jwtAuth, downloadQuantumPdf);

module.exports = router;
