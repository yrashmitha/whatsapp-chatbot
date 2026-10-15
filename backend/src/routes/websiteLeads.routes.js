'use strict';

const express   = require('express');
const rateLimit = require('express-rate-limit');
const jwtAuth   = require('../middleware/jwtAuth');
const { createLead, listWebsiteLeads } = require('../controllers/websiteLeads.controller');

// Basic anti-spam: 5 submissions/minute per IP
const leadsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many requests. Please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public router — mounted at /leads (no auth)
const publicRouter = express.Router();
publicRouter.post('/', leadsLimiter, createLead);

// Admin router — mounted at /api/website-leads
const adminRouter = express.Router();
adminRouter.get('/', jwtAuth, listWebsiteLeads);

module.exports = { publicRouter, adminRouter };
