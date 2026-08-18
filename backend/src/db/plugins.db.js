/**
 * @module db/plugins.db
 * @description Database access layer for plugin_configs and plugin_customer_data tables.
 * Abstracts over PostgreSQL (production) and SQLite (local dev).
 */

'use strict';

const { pool, db, IS_PG, pgQuery } = require('./connection');

/**
 * Retrieve the stored configuration object for a plugin + client pair.
 * Returns an empty object if no config has been saved yet.
 *
 * @param {string} clientId - Multi-tenant client ID
 * @param {string} pluginId - Plugin identifier (e.g. 'astro_vedic_chart')
 * @returns {Promise<Object>} Plugin configuration object
 */
async function getPluginConfig(clientId, pluginId) {
  if (IS_PG) {
    const r = await pool.query(
      `SELECT config FROM plugin_configs WHERE client_id=$1 AND plugin_id=$2`,
      [clientId, pluginId]
    );
    return r.rows[0]?.config ?? {};
  } else {
    const row = db.prepare(`SELECT config FROM plugin_configs WHERE client_id=? AND plugin_id=?`).get(clientId, pluginId);
    return row ? JSON.parse(row.config) : {};
  }
}

/**
 * Insert or update (upsert) the configuration for a plugin + client pair.
 *
 * @param {string} clientId - Multi-tenant client ID
 * @param {string} pluginId - Plugin identifier
 * @param {Object} config   - Full configuration object to persist
 * @returns {Promise<void>}
 */
async function upsertPluginConfig(clientId, pluginId, config) {
  if (IS_PG) {
    await pool.query(
      `INSERT INTO plugin_configs (client_id, plugin_id, config, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (client_id, plugin_id) DO UPDATE SET config=$3, updated_at=NOW()`,
      [clientId, pluginId, config]
    );
  } else {
    db.prepare(
      `INSERT INTO plugin_configs (client_id, plugin_id, config, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT (client_id, plugin_id) DO UPDATE SET config=excluded.config, updated_at=datetime('now')`
    ).run(clientId, pluginId, JSON.stringify(config));
  }
}

/**
 * Retrieve plugin-specific data stored for a particular customer.
 * Returns an empty object if no data has been saved yet.
 *
 * @param {string} clientId - Multi-tenant client ID
 * @param {string} phone    - E.164 customer phone number
 * @param {string} pluginId - Plugin identifier
 * @returns {Promise<Object>} Customer data object
 */
async function getPluginCustomerData(clientId, phone, pluginId) {
  if (IS_PG) {
    const r = await pool.query(
      `SELECT data FROM plugin_customer_data WHERE client_id=$1 AND phone_number=$2 AND plugin_id=$3`,
      [clientId, phone, pluginId]
    );
    return r.rows[0]?.data ?? {};
  } else {
    const row = db.prepare(`SELECT data FROM plugin_customer_data WHERE client_id=? AND phone_number=? AND plugin_id=?`).get(clientId, phone, pluginId);
    return row ? JSON.parse(row.data) : {};
  }
}

/**
 * Insert or update (upsert) plugin-specific customer data.
 *
 * @param {string} clientId - Multi-tenant client ID
 * @param {string} phone    - E.164 customer phone number
 * @param {string} pluginId - Plugin identifier
 * @param {Object} data     - Data object to persist
 * @returns {Promise<void>}
 */
async function upsertPluginCustomerData(clientId, phone, pluginId, data) {
  if (IS_PG) {
    await pool.query(
      `INSERT INTO plugin_customer_data (client_id, phone_number, plugin_id, data, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (client_id, phone_number, plugin_id) DO UPDATE SET data=$4, updated_at=NOW()`,
      [clientId, phone, pluginId, data]
    );
  } else {
    db.prepare(
      `INSERT INTO plugin_customer_data (client_id, phone_number, plugin_id, data, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT (client_id, phone_number, plugin_id) DO UPDATE SET data=excluded.data, updated_at=datetime('now')`
    ).run(clientId, phone, pluginId, JSON.stringify(data));
  }
}

/**
 * Whether a client has an addon enabled.
 *
 * Single source of the entitlement check, so feature access is decided by data
 * rather than by client IDs baked into the code.
 *
 * @param {string} clientId
 * @param {string} addonId
 * @returns {Promise<boolean>}
 */
async function hasAddon(clientId, addonId) {
  if (!clientId || !addonId) return false;
  const { rows } = await pgQuery(
    `SELECT 1 FROM client_addons WHERE client_id=$1 AND addon_id=$2 AND enabled=TRUE`,
    [clientId, addonId]
  );
  return rows.length > 0;
}

module.exports = { getPluginConfig, upsertPluginConfig, getPluginCustomerData, upsertPluginCustomerData, hasAddon };
