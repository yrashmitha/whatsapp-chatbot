/**
 * @module services/clientKeys
 * @description Resolves the third-party API keys (Gemini, freeastroapi) that a
 * given client's work should be billed to.
 *
 * Each client runs on their own keys so cost and rate limits land on them.
 * Resolution deliberately **fails closed**: when a client has no key and has not
 * explicitly opted into the platform key, the request errors instead of quietly
 * falling back to `process.env`. A silent fallback is how a new client runs for a
 * month on our quota without anyone noticing.
 *
 * `use_system_gemini_key` / `use_system_freeastro_key` are the only sanctioned
 * fallback, and they are an auditable per-client choice.
 */

'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { pgQuery } = require('../db/connection');
const { DEFAULT_MODEL, resolveModelId } = require('./geminiModels');

/** How long a resolved key set stays cached, in milliseconds. */
const CACHE_TTL_MS = 60 * 1000;

/** @type {Map<string, {at: number, keys: {gemini: string|null, freeastro: string|null, aiModel: string|null}}>} */
const cache = new Map();

/** @type {Map<string, import('@google/generative-ai').GoogleGenerativeAI>} */
const genAICache = new Map();

/**
 * Thrown when a client has no usable key for a provider.
 * Carries `statusCode` so controllers can surface it directly.
 */
class MissingClientKeyError extends Error {
  /**
   * @param {string} provider - 'Gemini' or 'freeastroapi'
   * @param {string|null} clientId
   */
  constructor(provider, clientId) {
    super(
      `No ${provider} API key configured for client "${clientId || '(none)'}". ` +
      `Set the client's own key, or explicitly enable the system key, in Clients settings.`
    );
    this.name       = 'MissingClientKeyError';
    this.provider   = provider;
    this.clientId   = clientId || null;
    this.statusCode = 503;
  }
}

/**
 * Load (and cache) the raw key configuration for a client.
 *
 * @param {string} clientId
 * @returns {Promise<{gemini: string|null, freeastro: string|null}>}
 */
async function loadKeys(clientId) {
  const hit = cache.get(clientId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.keys;

  const { rows } = await pgQuery(
    `SELECT gemini_api_key, use_system_gemini_key,
            freeastro_api_key, use_system_freeastro_key, ai_model
       FROM client_configs
      WHERE client_id = $1`,
    [clientId]
  );
  const row = rows[0] || {};

  const keys = {
    gemini: row.gemini_api_key
      || (row.use_system_gemini_key ? (process.env.GEMINI_API_KEY || null) : null),
    freeastro: row.freeastro_api_key
      || (row.use_system_freeastro_key ? (process.env.FREEASTRO_API_KEY || null) : null),
    aiModel: row.ai_model || null,
  };
  cache.set(clientId, { at: Date.now(), keys });
  return keys;
}

/**
 * Resolve the Gemini API key for a client.
 *
 * @param {string} clientId
 * @returns {Promise<string>}
 * @throws {MissingClientKeyError} When no key is configured for this client.
 */
async function getGeminiKey(clientId) {
  if (!clientId) throw new MissingClientKeyError('Gemini', clientId);
  const { gemini } = await loadKeys(clientId);
  if (!gemini) throw new MissingClientKeyError('Gemini', clientId);
  return gemini;
}

/**
 * Resolve the freeastroapi key for a client.
 *
 * @param {string} clientId
 * @returns {Promise<string>}
 * @throws {MissingClientKeyError} When no key is configured for this client.
 */
async function getFreeAstroKey(clientId) {
  if (!clientId) throw new MissingClientKeyError('freeastroapi', clientId);
  const { freeastro } = await loadKeys(clientId);
  if (!freeastro) throw new MissingClientKeyError('freeastroapi', clientId);
  return freeastro;
}

/**
 * Return a GoogleGenerativeAI client bound to this client's own Gemini key.
 *
 * Every report path must go through this rather than importing a module-level
 * singleton, otherwise the work is billed to the platform key.
 *
 * @param {string} clientId
 * @returns {Promise<import('@google/generative-ai').GoogleGenerativeAI>}
 * @throws {MissingClientKeyError}
 */
async function getGenAI(clientId) {
  const key = await getGeminiKey(clientId);
  let genAI = genAICache.get(key);
  if (!genAI) {
    genAI = new GoogleGenerativeAI(key);
    genAICache.set(key, genAI);
  }
  // Report code asks for the platform default by name. The client's own choice
  // (Clients > AI Model) replaces it here, so a client whose key Google no longer
  // lets use the default is moved by one setting, not by editing every caller.
  // A model a caller names on purpose is left alone.
  const modelId = await getClientModel(clientId);
  if (modelId === DEFAULT_MODEL) return genAI;
  const scoped = Object.create(genAI);
  scoped.getGenerativeModel = (params, requestOptions) => genAI.getGenerativeModel(
    params && params.model === DEFAULT_MODEL ? { ...params, model: modelId } : params,
    requestOptions);
  return scoped;
}

/**
 * The Gemini model this client is set to, always one we can price.
 *
 * @param {string} clientId
 * @returns {Promise<string>}
 */
async function getClientModel(clientId) {
  if (!clientId) return DEFAULT_MODEL;
  const { aiModel } = await loadKeys(clientId);
  return resolveModelId(aiModel);
}

/**
 * The model for code that only holds a raw API key (media extraction, the
 * quantum/aura calls, follow-up classification). Looked up from the clients whose
 * key this is; if clients sharing one key disagree, the default is used rather
 * than guessing. Meant to be called right after getGeminiKey, which loads it.
 *
 * @param {string} apiKey
 * @returns {string}
 */
function modelForKey(apiKey) {
  const found = new Set();
  for (const { keys } of cache.values()) {
    if (keys.gemini === apiKey) found.add(resolveModelId(keys.aiModel));
  }
  return found.size === 1 ? [...found][0] : DEFAULT_MODEL;
}

/**
 * Drop cached keys for a client (or all clients) after a settings change.
 *
 * @param {string} [clientId] - Omit to clear every client.
 * @returns {void}
 */
function invalidateClientKeys(clientId) {
  if (clientId) cache.delete(clientId);
  else cache.clear();
}

module.exports = {
  MissingClientKeyError,
  getGeminiKey,
  getFreeAstroKey,
  getGenAI,
  getClientModel,
  modelForKey,
  invalidateClientKeys,
};
