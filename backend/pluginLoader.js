const cache = {};

/**
 * Loads and caches the plugin for a given client.
 * Returns null if the client has no plugin file or plugin_enabled is false.
 * All hooks in returned plugin should be called inside try/catch in the caller.
 */
function loadPlugin(clientId, pluginEnabled) {
  if (!clientId || !pluginEnabled) return null;
  if (cache[clientId] !== undefined) return cache[clientId];
  try {
    const plugin = require(`./plugins/${clientId}.js`);
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
 * Invalidate cached plugin for a client (call when plugin_enabled is toggled).
 */
function invalidatePlugin(clientId) {
  delete cache[clientId];
}

module.exports = { loadPlugin, invalidatePlugin };
