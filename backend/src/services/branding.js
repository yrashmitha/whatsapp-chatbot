/**
 * @module services/branding
 * @description Single source of the per-client identity applied to generated
 * reports — signature, page footer, cover invocation, font, logo and PDF metadata.
 *
 * **No client's content is ever another client's default.** An unset field
 * renders as nothing: no invocation paragraph, no logo, no signature. The one
 * exception is the page footer and PDF author, which are structurally required
 * and fall back to the client's *own* brand name — never to anyone else's text.
 *
 * Report builders must take their strings from here rather than from literals,
 * so that adding a client is a data change and never a code change.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const axios = require('axios');
const { pgQuery } = require('../db/connection');
const { PUBLIC_URL, UPLOADS_DIR } = require('../config/env');

/** How long a resolved brand stays cached, in milliseconds. */
const CACHE_TTL_MS = 60 * 1000;

/** Largest logo we will fetch or embed. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/**
 * Typefaces bundled in assets/fonts and therefore installable into the
 * LibreOffice profile at conversion time.
 *
 * A font outside this list is not a cosmetic problem: LibreOffice silently
 * substitutes, Sinhala conjuncts collapse into boxes, and the customer receives
 * a broken-looking paid PDF behind a clean 200. So unknown values are rejected.
 *
 * @type {string[]}
 */
const FONT_ALLOWLIST = ['Abhaya Libre', 'Noto Sans Sinhala'];

/** Typeface used when a client has not chosen one. */
const FALLBACK_FONT = 'Abhaya Libre';

/**
 * Neutral identity used when a client has configured nothing.
 * Deliberately carries no brand text of any kind.
 *
 * @type {Readonly<Object>}
 */
const DEFAULT_BRAND = Object.freeze({
  clientId:       null,
  name:           '',
  signature:      '',
  footerTemplate: '{brand}',
  invocation:     '',
  divider:        '',
  font:           FALLBACK_FONT,
  logo:           null,
  pdf: Object.freeze({ title: '', author: '', subject: '', producer: '' }),
});

/** @type {Map<string, {at: number, brand: Object}>} */
const cache = new Map();

/**
 * Treat empty/whitespace-only config values as unset.
 *
 * @param {*} v
 * @returns {string|null}
 */
function clean(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? v : null;
}

/**
 * Load a logo from an uploaded file or an external URL.
 *
 * A broken logo must never break report generation, so every failure path
 * resolves to null with a warning rather than throwing.
 *
 * @param {string|null} url
 * @param {number} width
 * @param {number} height
 * @returns {Promise<{buffer: Buffer, type: string, width: number, height: number}|null>}
 */
async function loadLogo(url, width, height) {
  if (!url) return null;
  try {
    let buffer;
    const isLocal = url.startsWith('/uploads/')
      || (PUBLIC_URL && url.startsWith(`${PUBLIC_URL}/uploads/`));

    if (isLocal) {
      // basename() specifically, so a crafted URL cannot walk out of UPLOADS_DIR.
      const file = path.join(UPLOADS_DIR, path.basename(url.split('?')[0]));
      buffer = fs.readFileSync(file);
    } else if (/^https?:\/\//i.test(url)) {
      const resp = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 5000,
        maxContentLength: MAX_LOGO_BYTES,
      });
      buffer = Buffer.from(resp.data);
    } else {
      console.warn(`[BRANDING] Unsupported logo URL scheme: ${url}`);
      return null;
    }

    if (buffer.length > MAX_LOGO_BYTES) {
      console.warn(`[BRANDING] Logo exceeds ${MAX_LOGO_BYTES} bytes, ignoring: ${url}`);
      return null;
    }

    // docx's ImageRun needs an explicit type. Sniff it rather than trusting the
    // extension. SVG is rejected: it additionally requires a raster fallback.
    const isPng  = buffer.length > 8 && buffer.subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isJpeg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (!isPng && !isJpeg) {
      console.warn(`[BRANDING] Logo is not a PNG or JPEG, ignoring: ${url}`);
      return null;
    }

    return {
      buffer,
      type:   isPng ? 'png' : 'jpg',
      width:  Number(width)  > 0 ? Number(width)  : 160,
      height: Number(height) > 0 ? Number(height) : 160,
    };
  } catch (err) {
    console.warn(`[BRANDING] Could not load logo "${url}": ${err.message}`);
    return null;
  }
}

/**
 * Resolve the report identity for a client.
 *
 * Never throws and never 500s a report: an unknown client or a failed lookup
 * yields the neutral DEFAULT_BRAND.
 *
 * @param {string|null} clientId
 * @returns {Promise<Object>} Brand object (see DEFAULT_BRAND for the shape)
 */
async function getBrand(clientId) {
  if (!clientId) return DEFAULT_BRAND;

  const hit = cache.get(clientId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.brand;

  let row = {};
  try {
    const { rows } = await pgQuery(
      `SELECT c.name AS client_name,
              cc.brand_name, cc.logo_url,
              cc.report_signature, cc.report_footer, cc.report_invocation,
              cc.report_divider, cc.report_font,
              cc.report_logo_url, cc.report_logo_width, cc.report_logo_height,
              cc.pdf_title, cc.pdf_author, cc.pdf_subject, cc.pdf_producer
         FROM clients c
         JOIN client_configs cc ON cc.client_id = c.id
        WHERE c.id = $1`,
      [clientId]
    );
    row = rows[0] || {};
  } catch (err) {
    console.warn(`[BRANDING] Lookup failed for "${clientId}": ${err.message}`);
  }

  // The client's own display name — the only value allowed to stand in for an
  // unset field, because it is theirs.
  const name = clean(row.brand_name) || clean(row.client_name) || '';

  const requestedFont = clean(row.report_font);
  let font = FALLBACK_FONT;
  if (requestedFont) {
    if (FONT_ALLOWLIST.includes(requestedFont)) {
      font = requestedFont;
    } else {
      console.warn(
        `[BRANDING] Client "${clientId}" requested unbundled font "${requestedFont}"; ` +
        `falling back to ${FALLBACK_FONT}. Allowed: ${FONT_ALLOWLIST.join(', ')}`
      );
    }
  }

  const brand = Object.freeze({
    clientId,
    name,
    signature:      clean(row.report_signature)  || '',
    footerTemplate: clean(row.report_footer)     || '{brand}',
    invocation:     clean(row.report_invocation) || '',
    divider:        clean(row.report_divider)    || '',
    font,
    logo: await loadLogo(
      clean(row.report_logo_url) || clean(row.logo_url),
      row.report_logo_width,
      row.report_logo_height
    ),
    pdf: Object.freeze({
      title:    clean(row.pdf_title)    || name,
      author:   clean(row.pdf_author)   || name,
      subject:  clean(row.pdf_subject)  || '',
      producer: clean(row.pdf_producer) || name,
    }),
  });

  cache.set(clientId, { at: Date.now(), brand });
  return brand;
}

/**
 * Render the page footer text that precedes the page number.
 *
 * @param {Object} brand
 * @returns {string}
 */
function footerText(brand) {
  return (brand.footerTemplate || '{brand}').replace(/\{brand\}/g, brand.name || '');
}

/**
 * Drop cached branding for a client (or all clients) after a settings change.
 *
 * @param {string} [clientId] - Omit to clear every client.
 * @returns {void}
 */
function invalidateBrand(clientId) {
  if (clientId) cache.delete(clientId);
  else cache.clear();
}

module.exports = {
  DEFAULT_BRAND,
  FONT_ALLOWLIST,
  FALLBACK_FONT,
  getBrand,
  footerText,
  invalidateBrand,
};
