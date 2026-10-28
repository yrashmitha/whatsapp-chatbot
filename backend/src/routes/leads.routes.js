/**
 * @module routes/leads.routes
 * @description Lead quality and call log. Mounted at /api.
 *
 * Reading rides on followups.view and writing on followups.schedule, the
 * permissions operators already hold for the page this replaced.
 */

'use strict';

const router  = require('express').Router();
const jwtAuth = require('../middleware/jwtAuth');
const requirePermission = require('../middleware/requirePermission');
const { listLeads, leadsSummary, leadsStats, setLeadStatus, getLead, listCalls, logCall } = require('../controllers/leads.controller');

router.get('/leads',                      jwtAuth, requirePermission('followups.view'),     listLeads);
router.get('/leads/summary',              jwtAuth, requirePermission('followups.view'),     leadsSummary);
router.get('/leads/stats',                jwtAuth, requirePermission('followups.view'),     leadsStats);
router.get('/customers/:phone/lead',     jwtAuth, requirePermission('followups.view'),     getLead);
router.get('/customers/:phone/calls',    jwtAuth, requirePermission('followups.view'),     listCalls);
router.post('/customers/:phone/calls',    jwtAuth, requirePermission('followups.schedule'), logCall);
router.patch('/customers/:phone/lead-status', jwtAuth, requirePermission('followups.schedule'), setLeadStatus);

module.exports = router;
