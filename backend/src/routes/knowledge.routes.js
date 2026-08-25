/**
 * @module routes/knowledge.routes
 * @description Express router for knowledge base management endpoints.
 */

'use strict';

const router  = require('express').Router();
const requirePermission = require('../middleware/requirePermission');
const jwtAuth = require('../middleware/jwtAuth');
const {
  listSections,
  getChunks,
  addDocument,
  updateChunk,
  deleteChunk,
  deleteSection,
} = require('../controllers/knowledge.controller');

router.get('/',                    jwtAuth, requirePermission('settings.knowledge'), listSections);
router.get('/:title/chunks',       jwtAuth, requirePermission('settings.knowledge'), getChunks);
router.post('/',                   jwtAuth, requirePermission('settings.knowledge'), addDocument);
router.put('/chunks/:id',          jwtAuth, requirePermission('settings.knowledge'), updateChunk);
router.delete('/chunks/:id',       jwtAuth, requirePermission('settings.knowledge'), deleteChunk);
router.delete('/:title',           jwtAuth, requirePermission('settings.knowledge'), deleteSection);

module.exports = router;
