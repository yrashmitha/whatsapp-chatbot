/**
 * @module services/renderReportPdf
 * @description Render a finished order report to a PDF Buffer, on demand.
 *
 * The report is never stored — it is rebuilt from the JSON already on the order
 * (`horoscope_data` / `tarot_data`) every time it is downloaded. This reuses the
 * existing authenticated download handlers by invoking them with a synthetic
 * request/response pair, so there is exactly one code path per report kind.
 */

'use strict';

/**
 * Lazily resolved so this module can be required from a controller without a
 * circular-import hazard at load time.
 */
function handlerFor(kind) {
  const plugins = require('../controllers/plugins.controller');
  const addons  = require('../controllers/addons.controller');
  switch (kind) {
    case 'horoscope': return plugins.downloadHoroscopePdf;
    case 'quantum':   return plugins.downloadQuantumPdf;
    case 'marriage':  return plugins.downloadMarriagePdf;
    case 'match':     return plugins.downloadMatchPdf;
    case 'tarot':     return addons.downloadTarotPdfByOrder;
    default:          return null;
  }
}

/**
 * @param {string} orderId
 * @param {string} kind - horoscope | quantum | marriage | match | tarot
 * @param {string|null} clientId - owning tenant
 * @returns {Promise<{buffer: Buffer, filename: string, contentType: string}>}
 */
async function renderReportPdf(orderId, kind, clientId) {
  const handler = handlerFor(kind);
  if (!handler) {
    const e = new Error(`Unknown report kind: ${kind}`);
    e.status = 400;
    throw e;
  }

  return new Promise((resolve, reject) => {
    const req = {
      params:  { orderId },
      query:   clientId ? { client_id: clientId } : {},
      body:    {},
      headers: {},
      // The download handlers resolve the tenant via resolveClientId(req):
      // superadmin + query param mirrors an operator downloading it by hand.
      user:    { role: 'superadmin' },
    };

    let statusCode = 200;
    let filename = `${kind}-${orderId}.pdf`;
    let contentType = 'application/pdf';
    let settled = false;

    const res = {
      setHeader(name, value) {
        const k = String(name).toLowerCase();
        if (k === 'content-disposition') {
          const m = /filename="?([^"]+)"?/i.exec(String(value));
          if (m) filename = m[1];
        } else if (k === 'content-type') {
          contentType = String(value);
        }
      },
      set(name, value) { this.setHeader(name, value); return this; },
      status(code) { statusCode = code; return this; },
      json(obj) {
        if (settled) return;
        settled = true;
        const e = new Error(obj && obj.error ? obj.error : 'Report render failed');
        e.status = statusCode >= 400 ? statusCode : 500;
        reject(e);
      },
      send(body) {
        if (settled) return;
        settled = true;
        const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body || '');
        resolve({ buffer, filename, contentType });
      },
      end(body) { this.send(body); },
    };

    Promise.resolve()
      .then(() => handler(req, res))
      .catch((err) => { if (!settled) { settled = true; reject(err); } });
  });
}

module.exports = { renderReportPdf };
