/**
 * @module routes/plugins.routes
 * @description Express router for plugin configuration and astro chart endpoints.
 */

'use strict';

const router  = require('express').Router();
const jwtAuth = require('../middleware/jwtAuth');
const {
  getPluginConfig,
  updatePluginConfig,
  getPluginCustomerData,
  generateAstroChart,
  generateHoroscopeReading,
  updateHoroscopeSections,
  downloadHoroscope,
  downloadHoroscopePdf,
} = require('../controllers/plugins.controller');

router.get('/:pluginId/config',                   jwtAuth, getPluginConfig);
router.put('/:pluginId/config',                   jwtAuth, updatePluginConfig);
router.get('/:pluginId/customer-data/:phone',     jwtAuth, getPluginCustomerData);
router.post('/astro-chart',                       jwtAuth, generateAstroChart);
router.post('/horoscope/generate',                jwtAuth, generateHoroscopeReading);
router.patch('/horoscope/sections/:orderId',      jwtAuth, updateHoroscopeSections);
router.get('/horoscope/download/:orderId',        jwtAuth, downloadHoroscope);
router.get('/horoscope/download-pdf/:orderId',    jwtAuth, downloadHoroscopePdf);

module.exports = router;
