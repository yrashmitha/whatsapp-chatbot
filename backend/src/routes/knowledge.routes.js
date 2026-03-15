/**
 * @module routes/knowledge.routes
 * @description Express router for knowledge base management endpoints.
 */

'use strict';

const router  = require('express').Router();
const jwtAuth = require('../middleware/jwtAuth');
const {
  listSections,
  getChunks,
  addDocument,
  updateChunk,
  deleteChunk,
  deleteSection,
} = require('../controllers/knowledge.controller');

router.get('/',                    jwtAuth, listSections);
router.get('/:title/chunks',       jwtAuth, getChunks);
router.post('/',                   jwtAuth, addDocument);
router.put('/chunks/:id',          jwtAuth, updateChunk);
router.delete('/chunks/:id',       jwtAuth, deleteChunk);
router.delete('/:title',           jwtAuth, deleteSection);

module.exports = router;
