'use strict';

const express   = require('express');
const rateLimit = require('express-rate-limit');
const { startSession, onboard, chat, resumeSession, getSessions, getSessionMessages, getConfig, updateConfig, deleteSession, clearMessages } = require('../controllers/consult.controller');

// Strict: 10 requests/minute per IP
const consultLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public router — mounted at /consult (no auth)
const publicRouter = express.Router();
publicRouter.post('/start',         consultLimiter, startSession);
publicRouter.post('/onboard',       consultLimiter, onboard);
publicRouter.post('/chat',          consultLimiter, chat);
publicRouter.get('/session/:token', resumeSession);

// Admin router — mounted at /api/consult (jwtAuth applied in index.js)
const adminRouter = express.Router();
adminRouter.get('/sessions',                  getSessions);
adminRouter.get('/sessions/:token',           getSessionMessages);
adminRouter.delete('/sessions/:token',        deleteSession);
adminRouter.delete('/sessions/:token/messages', clearMessages);
adminRouter.get('/config',                    getConfig);
adminRouter.patch('/config',                  updateConfig);

module.exports = { publicRouter, adminRouter };
