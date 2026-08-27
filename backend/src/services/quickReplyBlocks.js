/**
 * @module services/quickReplyBlocks
 * @description Letting the prompt name a block instead of containing it.
 *
 * A service pitch is nine hundred characters of carefully worded Sinhala that
 * the client edits regularly. Pasting it into the system prompt means it lives
 * in two places, and within a day of pj rewriting their quick replies the
 * prompt was still sending the previous draft, prices and all.
 *
 * So the prompt writes [[QR:2990]] and the words are looked up when the message
 * is built. The client edits one quick reply and both the operator and the bot
 * send the same thing, which is the point.
 */

'use strict';

const db = require('../db');

/** @type {RegExp} Matches {{price}}, {{anchor}}, {{price:key}}, {{anchor:key}}. */
const PRICE_TOKEN = /\{\{(price|anchor)(?::([a-z0-9_-]+))?\}\}/gi;

/**
 * Format a figure the way the blocks already write it: 1500 -> "1,500".
 *
 * @param {number|string} n
 * @returns {string}
 */
function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return v.toLocaleString('en-US');
}

/**
 * Put the figures into a block.
 *
 * A block selling one thing resolves the bare {{price}} and {{anchor}}. A block
 * offering more than one - porondam pitches two tiers in a single message - has
 * to name which, as {{price:porondam-full}}. A token naming a service the block
 * does not sell renders empty rather than leaving braces in a customer's
 * message, and is reported to the caller.
 *
 * @param {string} text
 * @param {Array<{key:string,price:number,anchor:number}>} services
 * @returns {{text: string, unresolved: string[]}}
 */
function renderPrices(text, services) {
  if (!text || !Array.isArray(services) || !services.length) {
    return { text: text || '', unresolved: [] };
  }
  const byKey = new Map(services.map(s => [String(s.key).toLowerCase(), s]));
  const unresolved = [];

  const out = text.replace(PRICE_TOKEN, (whole, field, key) => {
    const svc = key ? byKey.get(key.toLowerCase()) : services[0];
    if (!svc) { unresolved.push(whole); return ''; }
    const v = field.toLowerCase() === 'anchor' ? svc.anchor : svc.price;
    if (v == null || v === '') { unresolved.push(whole); return ''; }
    return money(v);
  });

  return { text: out, unresolved };
}

/**
 * Every service this client sells, across all their blocks.
 *
 * This is the list place_order offers the model, so the catalogue the bot can
 * record an order against is exactly the catalogue the customer was quoted
 * from. There is no second list to keep in step, which is the whole point.
 *
 * @param {string} clientId
 * @returns {Promise<Array<{key:string,label:string,price:number,anchor:number|null,block:string}>>}
 */
async function servicesFor(clientId) {
  if (!clientId || !db.IS_PG) return [];
  const { rows } = await db.pgQuery(
    `SELECT title, services FROM quick_replies
      WHERE client_id=$1 AND jsonb_array_length(COALESCE(services,'[]'::jsonb)) > 0
      ORDER BY title`,
    [clientId]
  ).catch(() => ({ rows: [] }));

  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const list = Array.isArray(row.services) ? row.services : [];
    for (const s of list) {
      if (!s || !s.key) continue;
      const key = String(s.key).toLowerCase();
      // Two blocks claiming one key would make the price depend on which row
      // came back first. First wins, and the duplicate is dropped rather than
      // silently overriding a live price.
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        label:  s.label || s.key,
        price:  Number(s.price) || 0,
        anchor: (s.anchor == null || s.anchor === '') ? null : (Number(s.anchor) || null),
        block:  row.title,
      });
    }
  }
  return out;
}

/**
 * Price one service by key.
 *
 * @param {string} clientId
 * @param {string} key
 * @returns {Promise<{key:string,label:string,price:number,anchor:number|null,block:string}|null>}
 */
async function serviceByKey(clientId, key) {
  if (!key) return null;
  const all = await servicesFor(clientId);
  return all.find(s => s.key === String(key).toLowerCase()) || null;
}

/** @type {RegExp} Matches [[QR:title]], where a title may contain a dash. */
const QR_REGEX = /\[\[QR:([a-z0-9_-]+)\]\]/gi;

/**
 * Replace every [[QR:title]] in a reply with the quick reply it names.
 *
 * A title that does not exist is removed and reported rather than left in the
 * text, because a customer seeing "[[QR:2990]]" is worse than a short message.
 * The caller decides what to do when nothing is left.
 *
 * @param {string} clientId
 * @param {string} text
 * @returns {Promise<{text: string, used: string[], missing: string[]}>}
 */
async function resolveBlocks(clientId, text) {
  if (!text || !clientId) return { text: text || '', used: [], missing: [] };

  const wanted = [...new Set([...text.matchAll(QR_REGEX)].map(m => m[1].toLowerCase()))];
  if (!wanted.length) return { text, used: [], missing: [] };

  const { rows } = await db.pgQuery(
    'SELECT title, text, services FROM quick_replies WHERE client_id=$1 AND LOWER(title) = ANY($2)',
    [clientId, wanted]
  );
  // The figures live beside the block, not inside the sentence, so a reprice
  // is one edit rather than nine. They are rendered here, as the message is
  // built, for the same reason the block itself is.
  const byTitle = new Map(rows.map(r => {
    const { text: priced, unresolved } = renderPrices(r.text, r.services);
    if (unresolved.length) {
      console.warn(`[QR] ${clientId}/${r.title}: unresolved ${unresolved.join(', ')}`);
    }
    return [r.title.toLowerCase(), priced];
  }));

  const used = [];
  const missing = [];
  const out = text.replace(QR_REGEX, (_, rawTitle) => {
    const title = rawTitle.toLowerCase();
    const body = byTitle.get(title);
    if (body === undefined) {
      missing.push(title);
      return '';
    }
    used.push(title);
    return body;
  });

  return { text: out.replace(/\n{3,}/g, '\n\n').trim(), used, missing };
}

/**
 * The block names a client actually has, for telling the model what exists.
 *
 * @param {string} clientId
 * @returns {Promise<string[]>}
 */
async function listBlockNames(clientId) {
  const { rows } = await db.pgQuery(
    'SELECT title FROM quick_replies WHERE client_id=$1 ORDER BY title', [clientId]);
  return rows.map(r => r.title);
}

module.exports = {
  resolveBlocks, listBlockNames, renderPrices, servicesFor, serviceByKey, money,
  QR_REGEX, PRICE_TOKEN,
};
