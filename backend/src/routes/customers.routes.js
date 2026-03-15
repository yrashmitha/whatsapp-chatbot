/**
 * @module routes/customers.routes
 * @description Express router for CRM customer and message management endpoints.
 * Mounted at /api — handles /api/customers/*, /api/messages/*, /api/send, /api/clients.
 */

'use strict';

const router  = require('express').Router();
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
  listClients,
} = require('../controllers/customers.controller');

// Client list (superadmin only) — GET /api/clients
router.get('/clients',                               jwtAuth, listClients);

// Customer list — GET /api/customers
router.get('/customers',                             jwtAuth, listCustomers);

// Messages for a customer — GET /api/messages/:phone
router.get('/messages/:phone',                       jwtAuth, getMessages);

// Send WhatsApp message — POST /api/send
router.post('/send',                                 jwtAuth, sendMessage);

// Delete all messages for a customer — DELETE /api/customers/:phone/messages
router.delete('/customers/:phone/messages',          jwtAuth, deleteCustomerMessages);

// Soft-delete a single message — DELETE /api/messages/:id
router.delete('/messages/:id',                       jwtAuth, deleteMessage);

// Delete a customer — DELETE /api/customers/:phone
router.delete('/customers/:phone',                   jwtAuth, deleteCustomer);

// Mark customer messages as read — POST /api/customers/:phone/mark-read
router.post('/customers/:phone/mark-read',           jwtAuth, markRead);

// AI mode per customer
router.get('/customers/:phone/ai-mode',              jwtAuth, getAiMode);
router.patch('/customers/:phone/ai-mode',            jwtAuth, setAiMode);

module.exports = router;
