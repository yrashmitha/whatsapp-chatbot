/**
 * @module db/index
 * @description Barrel file — re-exports all database layer functions and
 * the IS_PG flag + pgQuery helper. Acts as a drop-in replacement for the
 * old monolithic db.js so existing callers can use require('../db').
 */

'use strict';

const { init }                                      = require('./schema');
const { IS_PG, pgQuery }                            = require('./connection');
const { insertMessage, getMessagesByPhone,
        deleteMessages, deleteMessage }             = require('./messages.db');
const { upsertCustomer, getAllCustomers,
        deleteCustomer, getCustomerAiEnabled,
        setCustomerAiMode }                         = require('./customers.db');
const { insertOrder, getOrdersByPhone, getLatestOrder,
        updateLatestOrderStatus, updateOrderStatusById,
        updateOrderAISummary, updateOrderCustomFields,
        countOrdersByYear }                         = require('./orders.db');
const { searchProducts, vectorSearchProducts,
        saveProductEmbedding, getAttributeSchema }  = require('./products.db');
const { insertKnowledgeChunks, vectorSearchKnowledge,
        getKnowledgeSections, getKnowledgeChunksByTitle,
        updateKnowledgeChunk, deleteKnowledgeChunk,
        deleteKnowledgeByTitle }                    = require('./knowledge.db');
const { getClientMedia, insertMedia,
        deleteMedia, updateMedia }                  = require('./media.db');
const { getPluginConfig, upsertPluginConfig,
        getPluginCustomerData,
        upsertPluginCustomerData }                  = require('./plugins.db');
const { insertCall, appendTranscriptTurn,
        updateCallStatus, updateCallSummary,
        listCalls, getCall }                        = require('./calls.db');
const { getVoiceClips, getVoiceClipByKeyword,
        insertVoiceClip, deleteVoiceClip }          = require('./voice_clips.db');

module.exports = {
  // Schema
  init,
  // Connection helpers
  IS_PG,
  pgQuery,
  // Messages
  insertMessage,
  getMessagesByPhone,
  deleteMessages,
  deleteMessage,
  // Customers
  upsertCustomer,
  getAllCustomers,
  deleteCustomer,
  getCustomerAiEnabled,
  setCustomerAiMode,
  // Orders
  insertOrder,
  getOrdersByPhone,
  getLatestOrder,
  updateLatestOrderStatus,
  updateOrderStatusById,
  updateOrderAISummary,
  updateOrderCustomFields,
  countOrdersByYear,
  // Products
  searchProducts,
  vectorSearchProducts,
  saveProductEmbedding,
  getAttributeSchema,
  // Knowledge
  insertKnowledgeChunks,
  vectorSearchKnowledge,
  getKnowledgeSections,
  getKnowledgeChunksByTitle,
  updateKnowledgeChunk,
  deleteKnowledgeChunk,
  deleteKnowledgeByTitle,
  // Media
  getClientMedia,
  insertMedia,
  deleteMedia,
  updateMedia,
  // Plugins
  getPluginConfig,
  upsertPluginConfig,
  getPluginCustomerData,
  upsertPluginCustomerData,
  // Calls
  insertCall,
  appendTranscriptTurn,
  updateCallStatus,
  updateCallSummary,
  listCalls,
  getCall,
  // Voice clips
  getVoiceClips,
  getVoiceClipByKeyword,
  insertVoiceClip,
  deleteVoiceClip,
};
