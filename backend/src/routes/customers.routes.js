/**
 * @module routes/customers.routes
 * @description Express router for CRM customer and message management endpoints.
 * Mounted at /api — handles /api/customers/*, /api/messages/*, /api/send, /api/clients.
 */

'use strict';

const router  = require('express').Router();
const requirePermission = require('../middleware/requirePermission');
const jwtAuth = require('../middleware/jwtAuth');
const {
  listCustomers,
  getMessages,
  sendMessage,
  deleteCustomerMessages,
  deleteMessage,
  deleteCustomer,
  markRead,
  getAiMode,
  setAiMode,
  claimChat,
  releaseChat,
  listClients,
} = require('../controllers/customers.controller');

// Client list (superadmin only) — GET /api/clients
router.get('/clients',                               jwtAuth, listClients);

// Customer list — GET /api/customers
router.get('/customers',                             jwtAuth, requirePermission('chat.read'), listCustomers);

// Messages for a customer — GET /api/messages/:phone
router.get('/messages/:phone',                       jwtAuth, requirePermission('chat.read'), getMessages);

// Send WhatsApp message — POST /api/send
router.post('/send',                                 jwtAuth, requirePermission('chat.reply'), sendMessage);

// Delete all messages for a customer — DELETE /api/customers/:phone/messages
router.delete('/customers/:phone/messages',          jwtAuth, requirePermission('chat.delete'), deleteCustomerMessages);

// Soft-delete a single message — DELETE /api/messages/:id
router.delete('/messages/:id',                       jwtAuth, requirePermission('chat.delete'), deleteMessage);

// Delete a customer — DELETE /api/customers/:phone
router.delete('/customers/:phone',                   jwtAuth, requirePermission('chat.delete'), deleteCustomer);

// Mark customer messages as read — POST /api/customers/:phone/mark-read
router.post('/customers/:phone/mark-read',           jwtAuth, requirePermission('chat.read'), markRead);

// AI mode per customer
router.get('/customers/:phone/ai-mode',              jwtAuth, requirePermission('chat.read'), getAiMode);
router.patch('/customers/:phone/ai-mode',            jwtAuth, requirePermission('chat.claim'), setAiMode);
router.post('/customers/:phone/claim',               jwtAuth, requirePermission('chat.claim'), claimChat);
router.post('/customers/:phone/release',             jwtAuth, requirePermission('chat.claim'), releaseChat);

module.exports = router;
