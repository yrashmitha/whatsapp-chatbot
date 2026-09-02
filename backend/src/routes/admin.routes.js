/**
 * @module routes/admin.routes
 * @description Express router for legacy /admin/* endpoints (no JWT — uses adminAuth middleware).
 */

'use strict';

const router    = require('express').Router();
const adminAuth = require('../middleware/adminAuth');
const { upload } = require('../config/multer');
const {
  listTemplates,
  listCustomers,
  getMessages,
  sendAdminMessage,
  deleteCustomer,
  deleteMessages,
  updateOrderStatus,
  proxyMedia,
  getBuiltinPrompt,
  listClients,
  getClient,
  uploadImage,
  createClient,
  updateClient,
  getClientBranding,
  updateClientBranding,
  listReportFonts,
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  listAttributes,
  createAttribute,
  deleteAttribute,
  bulkAttributes,
  bulkProducts,
  listPackages,
  createPackage,
  updatePackage,
  deletePackage,
  changeClientPackage,
} = require('../controllers/admin.controller');
const embeddedSignup = require('../controllers/embeddedSignup.controller');

// Templates
router.get('/templates',                       adminAuth, listTemplates);

// Customers & messages
router.get('/customers',                       adminAuth, listCustomers);
router.get('/messages/:phone',                 adminAuth, getMessages);
router.post('/send',                           adminAuth, sendAdminMessage);
router.delete('/customer/:phone',              adminAuth, deleteCustomer);
router.delete('/customer/:phone/messages',     adminAuth, deleteMessages);

// Orders
router.patch('/order/:orderId/status',         adminAuth, updateOrderStatus);

// Media proxy
router.get('/media/:mediaId',                  adminAuth, proxyMedia);

// AI tools
router.get('/builtin-prompt',                  adminAuth, getBuiltinPrompt);

// Client management
router.get('/clients',                         adminAuth, listClients);
router.get('/clients/:clientId',               adminAuth, getClient);
router.post('/upload-image',                   adminAuth, upload.single('image'), uploadImage);
router.post('/clients',                        adminAuth, createClient);
router.put('/clients/:clientId',               adminAuth, updateClient);
router.get('/clients/:clientId/branding',      adminAuth, getClientBranding);
router.put('/clients/:clientId/branding',      adminAuth, updateClientBranding);
router.get('/report-fonts',                    adminAuth, listReportFonts);

// WhatsApp Embedded Signup onboarding
router.get('/embedded-signup/config',          adminAuth, embeddedSignup.getConfig);
router.post('/embedded-signup',                adminAuth, embeddedSignup.complete);

// Products
router.get('/products',                        adminAuth, listProducts);
router.post('/products',                       adminAuth, createProduct);
router.put('/products/:id',                    adminAuth, updateProduct);
router.delete('/products/:id',                 adminAuth, deleteProduct);
router.post('/products/bulk',                  adminAuth, bulkProducts);

// Attributes
router.get('/attributes',                      adminAuth, listAttributes);
router.post('/attributes',                     adminAuth, createAttribute);
router.delete('/attributes/:id',               adminAuth, deleteAttribute);
router.post('/attributes/bulk',                adminAuth, bulkAttributes);

// Packages
router.get('/packages',                        adminAuth, listPackages);
router.post('/packages',                       adminAuth, createPackage);
router.patch('/packages/:packageId',           adminAuth, updatePackage);
router.delete('/packages/:packageId',          adminAuth, deletePackage);
router.patch('/clients/:clientId/package',     adminAuth, changeClientPackage);

module.exports = router;
