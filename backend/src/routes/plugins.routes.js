/**
 * @module routes/plugins.routes
 * @description Express router for plugin configuration and astro chart endpoints.
 */

'use strict';

const multer  = require('multer');
const router  = require('express').Router();
const requirePermission = require('../middleware/requirePermission');
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
  aiPrepareMarriageQuestions,
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
  listWhatsAppTemplates,
  templateSendsForOrders,
  sendWhatsAppTemplate,
  metaEventsForOrder,
  metaStatusesForOrders,
  metaSummaryForCustomer,
  retryMetaEvents,
  recentMetaEvents,
} = require('../controllers/plugins.controller');

// Memory-storage upload for aura selfie (max 10 MB, images only)
const auraUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

router.get('/:pluginId/config',                   jwtAuth, requirePermission('settings.plugins'), getPluginConfig);
router.put('/:pluginId/config',                   jwtAuth, requirePermission('settings.plugins'), updatePluginConfig);
router.get('/:pluginId/customer-data/:phone',     jwtAuth, requirePermission('orders.view'), getPluginCustomerData);
router.post('/astro-chart',                       jwtAuth, requirePermission('ai.astro_chart'), generateAstroChart);
router.post('/horoscope/analyze-aura',            jwtAuth, requirePermission('ai.generate_report'), auraUpload.single('image'), analyzeAuraImage);
router.post('/horoscope/ai-prepare/:orderId',     jwtAuth, requirePermission('ai.fill'), orderScope, aiPrepareHoroscope);
router.post('/horoscope/fetch-chart',             jwtAuth, requirePermission('ai.astro_chart'), orderScope, fetchChartData);
router.post('/horoscope/generate',                jwtAuth, requirePermission('ai.generate_report'), orderScope, generateHoroscopeReading);
router.get('/horoscope/progress/:orderId',        jwtAuth, requirePermission('orders.view'), orderScope, horoscopeProgress);
router.patch('/horoscope/sections/:orderId',         jwtAuth, requirePermission('reports.edit'), orderScope, updateHoroscopeSections);
router.patch('/horoscope/quantum-sections/:orderId',    jwtAuth, requirePermission('reports.edit'), orderScope, updateQuantumSections);
router.post('/horoscope/regenerate-quantum/:orderId',         jwtAuth, requirePermission('ai.generate_report'), orderScope, regenerateQuantumSections);
router.post('/horoscope/regenerate-quantum-section/:orderId',   jwtAuth, requirePermission('ai.generate_report'), orderScope, regenerateQuantumSection);
router.post('/horoscope/regenerate-section/:orderId',            jwtAuth, requirePermission('ai.generate_report'), orderScope, regenerateHoroscopeSectionHandler);
router.get('/horoscope/download/:orderId',        jwtAuth, requirePermission('reports.download'), orderScope, downloadHoroscope);
router.get('/horoscope/download-pdf/:orderId',    jwtAuth, requirePermission('reports.download'), orderScope, downloadHoroscopePdf);
router.get('/horoscope/download-quantum-docx/:orderId', jwtAuth, requirePermission('reports.download'), orderScope, downloadQuantumDocx);
router.get('/horoscope/download-quantum-pdf/:orderId',  jwtAuth, requirePermission('reports.download'), orderScope, downloadQuantumPdf);
router.patch('/horoscope/wa-message/:orderId',           jwtAuth, requirePermission('reports.edit'), orderScope, saveWaMessageHandler);
router.post('/horoscope/generate-wa-message/:orderId',  jwtAuth, requirePermission('ai.generate_report'), orderScope, generateWaMessageHandler);
router.post('/horoscope/generate-marriage/:orderId',            jwtAuth, requirePermission('ai.generate_report'), orderScope, generateMarriageHandler);
router.post('/horoscope/regenerate-marriage-section/:orderId',  jwtAuth, requirePermission('ai.generate_report'), orderScope, regenerateMarriageSectionHandler);
router.patch('/horoscope/marriage-sections/:orderId',           jwtAuth, requirePermission('reports.edit'), orderScope, updateMarriageSections);
router.get('/horoscope/download-marriage-docx/:orderId',        jwtAuth, requirePermission('reports.download'), orderScope, downloadMarriageDocx);
router.get('/horoscope/download-marriage-pdf/:orderId',         jwtAuth, requirePermission('reports.download'), orderScope, downloadMarriagePdf);
router.post('/horoscope/generate-marriage-wa/:orderId',         jwtAuth, requirePermission('ai.generate_report'), orderScope, generateMarriageWaHandler);
router.patch('/horoscope/marriage-wa/:orderId',                 jwtAuth, requirePermission('reports.edit'), orderScope, saveMarriageWaHandler);
router.post('/horoscope/ai-prepare-marriage/:orderId',          jwtAuth, requirePermission('ai.fill'), orderScope, aiPrepareMarriageQuestions);
router.post('/horoscope/ai-prepare-match/:orderId',              jwtAuth, requirePermission('ai.fill'), orderScope, aiPrepareMatch);
router.patch('/horoscope/match-people/:orderId',                jwtAuth, requirePermission('orders.edit'), orderScope, saveMatchPeople);
router.post('/horoscope/generate-match/:orderId',               jwtAuth, requirePermission('ai.generate_report'), orderScope, generateMatchHandler);
router.post('/horoscope/regenerate-match-section/:orderId',     jwtAuth, requirePermission('ai.generate_report'), orderScope, regenerateMatchSectionHandler);
router.patch('/horoscope/match-sections/:orderId',              jwtAuth, requirePermission('reports.edit'), orderScope, updateMatchSections);
router.get('/horoscope/download-match-docx/:orderId',           jwtAuth, requirePermission('reports.download'), orderScope, downloadMatchDocx);
router.get('/horoscope/download-match-pdf/:orderId',            jwtAuth, requirePermission('reports.download'), orderScope, downloadMatchPdf);
// Full 20-Porondam report (data comes from the pahantharu_web site) — docx + PDF
router.get('/horoscope/download-porondam-docx/:orderId',        jwtAuth, requirePermission('reports.download'), orderScope, downloadPorondamDocx);
router.get('/horoscope/download-porondam-pdf/:orderId',         jwtAuth, requirePermission('reports.download'), orderScope, downloadPorondamPdf);
router.post('/follow-up',                               jwtAuth, requirePermission('ai.followup_draft'), generateFollowUpMessage);
router.get('/meta/recent-events',                       jwtAuth, requirePermission('settings.keys'), recentMetaEvents);
// Readable by anyone who can see the order it belongs to - it reports on that
// order and nothing else, and hiding it behind the key permission would keep it
// from the operators who work the orders.
router.get('/whatsapp/templates',                       jwtAuth, requirePermission('chat.reply'), listWhatsAppTemplates);
// Sending a paid marketing message to a list of people is a bigger act than
// replying to one who just wrote in, so it sits behind the media permission
// rather than plain reply.
router.post('/whatsapp/send-template',                  jwtAuth, requirePermission('chat.send_media'), sendWhatsAppTemplate);
router.get('/whatsapp/template-sends',                  jwtAuth, requirePermission('orders.view'), templateSendsForOrders);
router.get('/meta/statuses',                            jwtAuth, requirePermission('orders.view'), metaStatusesForOrders);
router.get('/meta/summary',                             jwtAuth, requirePermission('orders.view'), metaSummaryForCustomer);
router.get('/meta/events/:orderId',                     jwtAuth, requirePermission('orders.view'), metaEventsForOrder);
// Resending is a write, and reporting a sale to an ad platform is not an
// operator's call, so it sits behind the status permission rather than view.
router.post('/meta/retry/:orderId',                     jwtAuth, requirePermission('orders.status'), retryMetaEvents);
router.post('/meta/sync-audience',                      jwtAuth, requirePermission('settings.keys'), syncMetaAudience);
router.post('/meta/create-audience',                    jwtAuth, requirePermission('settings.keys'), createMetaAudience);

module.exports = router;
