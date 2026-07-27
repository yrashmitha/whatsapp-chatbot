/**
 * @module services/vedicChart
 * @description Single source of truth for freeastroapi vedic chart calls.
 * Deduplicates identical birth-data requests via the astro_cache table so we
 * never spend a paid/free API call twice on the same natal chart (a birth
 * chart is fixed forever, so the natal + varga data is permanently cacheable).
 *
 * Used by:
 *   - public.controller  → POST /public/chart  (web FE chart preview)
 *   - plugins.controller  → fetchChartData      (admin fetch)
 *   - horoscope service   → full report pipeline
 */

'use strict';

const crypto = require('crypto');
const axios  = require('axios');
const { IS_PG, pool, db } = require('../db/connection');

const FREEASTRO_URL = 'https://api.freeastroapi.com/api/v1/vedic/calculate';

/**
 * Build the canonical freeastroapi payload from loose birth input.
 * Rounds lat/lng to 4dp so trivially-different coordinates for the same place
 * still hit the cache.
 */
function normalizeBirth(b) {
  return {
    year:   Number(b.year),
    month:  Number(b.month),
    day:    Number(b.day),
    hour:   Number(b.hour),
    minute: Number(b.minute),
    lat:    Number(parseFloat(b.lat).toFixed(4)),
    lng:    Number(parseFloat(b.lng).toFixed(4)),
    tz_str:       b.tz_str       || 'Asia/Colombo',
    ayanamsha:    b.ayanamsha    || 'lahiri',
    house_system: b.house_system || 'whole_sign',
    node_type:    b.node_type    || 'mean',
    vargas:       Array.isArray(b.vargas) ? b.vargas : [1, 9, 7],
    dasha_levels: b.dasha_levels != null ? Number(b.dasha_levels) : 2,
  };
}

/** Deterministic hash of the canonical payload — the cache key. */
function birthHash(payload) {
  const key = [
    payload.year, payload.month, payload.day, payload.hour, payload.minute,
    payload.lat, payload.lng, payload.tz_str, payload.ayanamsha,
    payload.house_system, payload.node_type,
    (payload.vargas || []).join('-'), payload.dasha_levels,
  ].join('|');
  return crypto.createHash('sha1').update(key).digest('hex');
}

async function cacheGet(hash) {
  if (IS_PG) {
    const r = await pool.query('SELECT response FROM astro_cache WHERE birth_hash=$1', [hash]);
    return r.rows[0]?.response || null; // JSONB decodes to an object
  }
  const row = db.prepare('SELECT response FROM astro_cache WHERE birth_hash=?').get(hash);
  return row ? JSON.parse(row.response) : null;
}

async function cacheSet(hash, response) {
  if (IS_PG) {
    await pool.query(
      `INSERT INTO astro_cache (birth_hash, response) VALUES ($1, $2::jsonb)
       ON CONFLICT (birth_hash) DO NOTHING`,
      [hash, JSON.stringify(response)]
    );
  } else {
    db.prepare('INSERT OR IGNORE INTO astro_cache (birth_hash, response) VALUES (?, ?)')
      .run(hash, JSON.stringify(response));
  }
}

/**
 * Return the full freeastroapi response for a birth, using the cache when
 * possible. Only calls the external API on a cache miss.
 *
 * @param {Object} birth  - { year, month, day, hour, minute, lat, lng, ... }
 * @param {string} [apiKey] - Override key (falls back to FREEASTRO_API_KEY)
 * @returns {Promise<{ data: Object, cached: boolean, hash: string }>}
 */
async function calculateVedicChart(birth, apiKey) {
  const payload = normalizeBirth(birth);
  const hash    = birthHash(payload);

  const cached = await cacheGet(hash);
  if (cached) return { data: cached, cached: true, hash };

  const key = apiKey || process.env.FREEASTRO_API_KEY;
  if (!key) throw new Error('FREEASTRO_API_KEY not configured');

  const resp = await axios.post(FREEASTRO_URL, payload, {
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  await cacheSet(hash, resp.data);
  return { data: resp.data, cached: false, hash };
}

module.exports = { calculateVedicChart, birthHash, normalizeBirth };
