/**
 * @module services/deliveredHoroscope
 * @description Finds a customer's already-delivered report and normalises it
 * into one shape regardless of which report produced it:
 *   - full reading     → horoscope_data.sections (object: title -> text)
 *   - marriage reading → horoscope_data.marriage_sections_data ([{label, content}])
 *   - porondam / match → horoscope_data.match_boy / match_girl + match_sections_data
 *
 * Ported from the wwjs service, where this read across to a second database.
 * Here the reports are local, so it queries our own orders table — which means
 * no cache is needed and a regenerated report is picked up immediately.
 *
 * Phone matching is on the last 9 digits (the subscriber number, without
 * country code or trunk zero) because numbers have accumulated in several
 * formats over time.
 */

'use strict';

const { pgQuery } = require('../db/connection');

/**
 * Strip non-digits and take the rightmost 9 — the subscriber number, however
 * the source happened to store it.
 *
 * @param {string} phone
 * @returns {string}
 */
function last9Digits(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-9);
}

/**
 * @param {*} v
 * @returns {Object|null}
 */
function parseJsonField(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

/**
 * Convert horoscope_data.sections (keyed by section title) into the same
 * [{label, content}] array the marriage and match reports already use.
 *
 * @param {Object} sections
 * @returns {Array<{label: string, content: string}>}
 */
function sectionsObjectToArray(sections) {
  return Object.entries(sections || {}).map(([label, content]) => ({ label, content }));
}

/**
 * Pull one person's identifying details out of an order's custom_fields.
 *
 * @param {Object} cf
 * @returns {{name: string|null, birthDate: string|null, birthTime: string|null, birthPlace: string|null, lagna: string|null}}
 */
function personFromCustomFields(cf) {
  return {
    name:       cf?.customer_name || cf?.name || null,
    birthDate:  cf?.birth_date  || null,
    birthTime:  cf?.birth_time  || null,
    birthPlace: cf?.birth_place || null,
    lagna:      cf?.lagnaya || cf?.lagna || null,
  };
}

/**
 * Normalise one order row into the shape the Q&A panel consumes.
 *
 * @param {Object} row - { order_id, custom_fields, horoscope_data }
 * @returns {Object|null} Null when the order carries no usable report content.
 */
function normalizeOrderRow(row) {
  const cf = parseJsonField(row.custom_fields) || {};
  const hd = parseJsonField(row.horoscope_data) || {};

  if (hd.match_boy || hd.match_girl) {
    const sections = Array.isArray(hd.match_sections_data) ? hd.match_sections_data : [];
    if (!sections.length && !hd.match_boy && !hd.match_girl) return null;
    const person = (p) => (p ? {
      name:      p.name || null,
      birthDate: p.birth_date || null,
      birthTime: p.birth_time || null,
      birthPlace: p.birth_place_name || null,
      lagna:     p.lagna || null,
      chartData: p.chart_data || null,
    } : null);
    return {
      orderId:   row.order_id,
      fetchedAt: new Date().toISOString(),
      type:      'match',
      match: {
        boy:  person(hd.match_boy),
        girl: person(hd.match_girl),
        sections,
        // Questions the couple already asked and had answered in the report.
        // Without these a follow-up on the same topic can contradict what they
        // are holding in their hands.
        answers: Array.isArray(hd.match_special_answers) ? hd.match_special_answers : [],
      },
    };
  }

  const sections = hd.sections && typeof hd.sections === 'object'
    ? sectionsObjectToArray(hd.sections)
    : (Array.isArray(hd.marriage_sections_data) ? hd.marriage_sections_data : []);

  if (!sections.length) return null;

  return {
    orderId:   row.order_id,
    fetchedAt: new Date().toISOString(),
    type:      'single',
    single: {
      ...personFromCustomFields(cf),
      sections,
      chartData: hd.chart_data || null,
      answers:   Array.isArray(hd.special_answers) ? hd.special_answers : [],
    },
  };
}

/**
 * The most recent delivered report for a phone number, within one client.
 *
 * Scoped to clientId: unlike the cross-database original, this reads the shared
 * multi-tenant orders table, so an unscoped lookup would expose another
 * client's customer reports.
 *
 * @param {string} clientId
 * @param {string} phone - Any format
 * @returns {Promise<Object|null>}
 */
async function fetchLatestHoroscopeForPhone(clientId, phone) {
  const key = last9Digits(phone);
  if (!clientId || key.length < 9) return null;

  const { rows } = await pgQuery(
    `SELECT order_id, custom_fields, horoscope_data
       FROM orders
      WHERE client_id = $1
        AND horoscope_data IS NOT NULL
        AND RIGHT(regexp_replace(phone_number, '\\D', '', 'g'), 9) = $2
      ORDER BY created_at DESC
      LIMIT 5`,
    [clientId, key]
  );

  // The newest order may be one whose report has not been generated yet, so
  // walk back until a row actually carries content.
  for (const row of rows) {
    const record = normalizeOrderRow(row);
    if (record) return record;
  }
  return null;
}

module.exports = { fetchLatestHoroscopeForPhone, normalizeOrderRow, last9Digits };
