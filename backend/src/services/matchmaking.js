/**
 * @module services/matchmaking
 * @description Wraps freeastroapi's Ashtakoota (Kundli/Kuta) matching endpoint
 * (POST /api/v2/vedic/match) — the North Indian 8-koota compatibility system,
 * shown alongside our primary Sri Lankan 20-Porondam calculation (which is
 * computed entirely client-side). This endpoint is the only place we get a
 * REAL Manglik/Kuja dosha check (with cancellation rules) — the 20-Porondam
 * math never analyzes Mars at all.
 *
 * Cached in match_cache by a hash of both persons' normalized birth params,
 * so the exact same pair of people is only ever charged one API call, ever.
 */

'use strict';

const crypto = require('crypto');
const axios  = require('axios');
const { IS_PG, pool, db } = require('../db/connection');

const MATCH_URL = 'https://api.freeastroapi.com/api/v2/vedic/match';

function normalizePerson(p) {
  return {
    year:   Number(p.year),
    month:  Number(p.month),
    day:    Number(p.day),
    hour:   Number(p.hour),
    minute: Number(p.minute),
    lat:    Number(parseFloat(p.lat).toFixed(4)),
    lng:    Number(parseFloat(p.lng).toFixed(4)),
    ayanamsha:    p.ayanamsha    || 'lahiri',
    house_system: p.house_system || 'whole_sign',
    node_type:    p.node_type    || 'mean',
  };
}

function personKey(p) {
  return [p.year, p.month, p.day, p.hour, p.minute, p.lat, p.lng, p.ayanamsha, p.house_system, p.node_type].join('|');
}

function matchHash(p1, p2) {
  const key = `${personKey(p1)}||${personKey(p2)}`;
  return crypto.createHash('sha1').update(key).digest('hex');
}

async function cacheGet(hash) {
  if (IS_PG) {
    const r = await pool.query('SELECT response FROM match_cache WHERE match_hash=$1', [hash]);
    return r.rows[0]?.response || null; // JSONB decodes to an object
  }
  const row = db.prepare('SELECT response FROM match_cache WHERE match_hash=?').get(hash);
  return row ? JSON.parse(row.response) : null;
}

async function cacheSet(hash, response) {
  if (IS_PG) {
    await pool.query(
      `INSERT INTO match_cache (match_hash, response) VALUES ($1, $2::jsonb)
       ON CONFLICT (match_hash) DO NOTHING`,
      [hash, JSON.stringify(response)]
    );
  } else {
    db.prepare('INSERT OR IGNORE INTO match_cache (match_hash, response) VALUES (?, ?)')
      .run(hash, JSON.stringify(response));
  }
}

/**
 * Return the Ashtakoota match result for two people, using the cache when
 * possible. Only calls the external API on a cache miss.
 *
 * @param {Object} person1 - { year, month, day, hour, minute, lat, lng, ... }
 * @param {Object} person2 - Same shape as person1
 * @param {string} [apiKey] - Override key (falls back to FREEASTRO_API_KEY)
 * @returns {Promise<{ data: Object, cached: boolean }>}
 */
async function calculateMatch(person1, person2, apiKey) {
  const p1 = normalizePerson(person1);
  const p2 = normalizePerson(person2);
  const hash = matchHash(p1, p2);

  const cached = await cacheGet(hash);
  if (cached) return { data: cached, cached: true };

  const key = apiKey || process.env.FREEASTRO_API_KEY;
  if (!key) throw new Error('FREEASTRO_API_KEY not configured');

  const resp = await axios.post(MATCH_URL, { person1: p1, person2: p2 }, {
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  await cacheSet(hash, resp.data);
  return { data: resp.data, cached: false };
}

module.exports = { calculateMatch, matchHash, normalizePerson };
