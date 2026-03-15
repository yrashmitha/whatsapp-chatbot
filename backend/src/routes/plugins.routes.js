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
} = require('../controllers/plugins.controller');

router.get('/:pluginId/config',                  jwtAuth, getPluginConfig);
router.put('/:pluginId/config',                  jwtAuth, updatePluginConfig);
router.get('/:pluginId/customer-data/:phone',    jwtAuth, getPluginCustomerData);
router.post('/astro-chart',                      jwtAuth, generateAstroChart);

module.exports = router;
