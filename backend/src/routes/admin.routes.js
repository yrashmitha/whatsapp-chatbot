/**
 * @module routes/admin.routes
 * @description Express router for legacy /admin/* endpoints (no JWT — uses adminAuth middleware).
 */

'use strict';

const router    = require('express').Router();
const adminAuth = require('../middleware/adminAuth');
const jwtAuth   = require('../middleware/jwtAuth');
const { upload } = require('../config/multer');

// Accepts either a valid superadmin JWT or the legacy admin password.
// Keeps onboard.html working while allowing the React CRM to use JWT.
function superAdminOrAdminAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    return jwtAuth(req, res, (err) => {
      if (!err && req.user?.role === 'superadmin') return next();
      return adminAuth(req, res, next);
    });
  }
  return adminAuth(req, res, next);
}
const {
  listTemplates,
  listCustomers,
  getMessages,
  sendAdminMessage,
  deleteCustomer,
  deleteMessages,
  updateOrderStatus,
  proxyMedia,
  generateFollowup,
  getBuiltinPrompt,
  listClients,
  getClient,
  uploadImage,
  createClient,
  updateClient,
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  listAttributes,
  createAttribute,
  deleteAttribute,
  bulkAttributes,
  bulkProducts,
} = require('../controllers/admin.controller');

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
router.post('/followup',                       adminAuth, generateFollowup);
router.get('/builtin-prompt',                  adminAuth, getBuiltinPrompt);

// Client management
router.get('/clients',                         superAdminOrAdminAuth, listClients);
router.get('/clients/:clientId',               superAdminOrAdminAuth, getClient);
router.post('/upload-image',                   superAdminOrAdminAuth, upload.single('image'), uploadImage);
router.post('/clients',                        superAdminOrAdminAuth, createClient);
router.put('/clients/:clientId',               superAdminOrAdminAuth, updateClient);

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

module.exports = router;
