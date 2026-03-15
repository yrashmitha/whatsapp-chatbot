/**
 * @module services/pluginLoader
 * @description Loads and caches per-client plugin modules.
 * Moved from backend/pluginLoader.js — plugin path updated to ../../plugins/.
 */

'use strict';

const cache = {};

/**
 * Load and cache the plugin for a given client.
 * Returns null if the client has no plugin file or plugin_enabled is false.
 * All hooks in the returned plugin should be called inside try/catch by the caller.
 *
 * @param {string|null}  clientId      - Multi-tenant client ID
 * @param {boolean|null} pluginEnabled - Whether the plugin is enabled for this client
 * @returns {Object|null} Plugin module, or null if unavailable/disabled
 */
function loadPlugin(clientId, pluginEnabled) {
  if (!clientId || !pluginEnabled) return null;
  if (cache[clientId] !== undefined) return cache[clientId];
  try {
    const plugin = require(`../../plugins/${clientId}.js`);
    cache[clientId] = plugin;
    console.log(`[PLUGIN] Loaded plugin for client: ${clientId}`);
    return plugin;
  } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') {
      console.error(`[PLUGIN] Error loading plugin for ${clientId}:`, e.message);
    }
    cache[clientId] = null;
    return null;
  }
}

/**
 * Invalidate the cached plugin for a client.
 * Call when plugin_enabled is toggled so the new state is reflected immediately.
 *
 * @param {string} clientId - Multi-tenant client ID
 * @returns {void}
 */
function invalidatePlugin(clientId) {
  delete cache[clientId];
}

module.exports = { loadPlugin, invalidatePlugin };
