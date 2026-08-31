/**
 * @module controllers/delivery.controller
 * @description Self-service report delivery.
 *
 *  Admin (JWT, /api/plugins/delivery/*) — the editor drawers use these:
 *    GET    /:orderId            → link + release/gate state for the drawer
 *    POST   /:orderId/ensure     → mint the token if absent, return the URL
 *    POST   /:orderId/release    → "Report is ready" button ({ kind })
 *    POST   /:orderId/unrelease  → undo
 *    PATCH  /:orderId            → { phoneGate: boolean }
 *
 *  Internal (X-Delivery-Key, /internal/delivery/*) — the www.puranajothirwedaya.com site
 *  calls these; it never touches this database directly:
 *    GET    /:token          → { status, kind, phoneGate, nameHint }
 *    POST   /:token/verify   → { ok } for a supplied last-4 of phone
 *    GET    /:token/file     → streams the freshly rendered PDF
 */

'use strict';

const db              = require('../db');
const resolveClientId = require('../middleware/resolveClientId');
const delivery        = require('../services/reportDelivery');
const { renderReportPdf } = require('../services/renderReportPdf');
const { customerNameFrom } = require('../utils/customerName');

function parseJson(v) {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return {}; }
}

// ── Admin ───────────────────────────────────────────────────────────────────

/** Shape the drawer needs to render the delivery panel. */
function adminView(row) {
  const st = delivery.projectStatus(row);
  return {
    order_id:     row.order_id,
    token:        row.delivery_token || null,
    url:          delivery.deliveryUrl(row.delivery_token),
    kind:         st.kind,
    released:     st.released,
    released_at:  row.delivery_released_at || null,
    has_content:  st.hasContent,
    status:       st.status,
    phone_gate:   st.phoneGate,
    phone_last4:  delivery.phoneLast4(row) || null,
    opened_at:    row.delivery_opened_at || null,
    downloads:    row.delivery_downloads || 0,
  };
}

async function getDeliveryInfo(req, res) {
  const clientId = resolveClientId(req);
  const row = await delivery.getDeliveryRow(req.params.orderId, clientId);
  if (!row) return res.status(404).json({ error: 'Order not found' });
  res.json(adminView(row));
}

async function ensureDeliveryLink(req, res) {
  const clientId = resolveClientId(req);
  const token = await delivery.ensureToken(req.params.orderId, clientId);
  if (!token) return res.status(404).json({ error: 'Order not found' });
  const row = await delivery.getDeliveryRow(req.params.orderId, clientId);
  res.json(adminView(row));
}

async function releaseDelivery(req, res) {
  const clientId = resolveClientId(req);
  const { orderId } = req.params;
  const kind = (req.body && req.body.kind) || null;

  const row = await delivery.getDeliveryRow(orderId, clientId);
  if (!row) return res.status(404).json({ error: 'Order not found' });

  const effectiveKind = delivery.VALID_KINDS.includes(kind) ? kind : delivery.detectKind(row);
  if (!effectiveKind) {
    return res.status(400).json({ error: 'Cannot tell which report to release — pass { kind }.' });
  }
  if (!delivery.hasContentForKind(row, effectiveKind)) {
    return res.status(400).json({ error: `No generated ${effectiveKind} report on this order yet.` });
  }

  await delivery.ensureToken(orderId, clientId);
  await delivery.setReleased(orderId, clientId, true, effectiveKind);
  const fresh = await delivery.getDeliveryRow(orderId, clientId);
  res.json(adminView(fresh));
}

async function unreleaseDelivery(req, res) {
  const clientId = resolveClientId(req);
  const row = await delivery.getDeliveryRow(req.params.orderId, clientId);
  if (!row) return res.status(404).json({ error: 'Order not found' });
  await delivery.setReleased(req.params.orderId, clientId, false, null);
  const fresh = await delivery.getDeliveryRow(req.params.orderId, clientId);
  res.json(adminView(fresh));
}

async function patchDeliverySettings(req, res) {
  const clientId = resolveClientId(req);
  const row = await delivery.getDeliveryRow(req.params.orderId, clientId);
  if (!row) return res.status(404).json({ error: 'Order not found' });
  if (typeof req.body?.phoneGate === 'boolean') {
    await delivery.setPhoneGate(req.params.orderId, clientId, req.body.phoneGate);
  }
  const fresh = await delivery.getDeliveryRow(req.params.orderId, clientId);
  res.json(adminView(fresh));
}

// ── Internal (called by pahantharu_web) ─────────────────────────────────────

async function internalStatus(req, res) {
  const row = await delivery.getOrderByToken(req.params.token);
  if (!row) return res.status(404).json({ error: 'not_found' });

  const st = delivery.projectStatus(row);
  const cf = parseJson(row.custom_fields);
  const name = customerNameFrom(cf, null) || '';
  const nameHint = name ? name.trim().split(/\s+/)[0] : '';

  if (st.status === 'ready') {
    delivery.markOpened(row.order_id).catch(() => {});
  }

  res.json({
    status:     st.status,          // 'pending' | 'ready'
    kind:       st.kind,
    phone_gate: st.phoneGate,
    name_hint:  nameHint,
  });
}

async function internalVerify(req, res) {
  const row = await delivery.getOrderByToken(req.params.token);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const last4 = (req.body && req.body.last4) || req.query.last4 || '';
  res.json({ ok: delivery.verifyLast4(row, last4) });
}

async function internalFile(req, res) {
  const row = await delivery.getOrderByToken(req.params.token);
  if (!row) return res.status(404).json({ error: 'not_found' });

  const st = delivery.projectStatus(row);
  if (st.status !== 'ready') return res.status(409).json({ error: 'not_ready' });

  if (st.phoneGate) {
    const last4 = req.get('X-Delivery-Last4') || req.query.last4 || '';
    if (!delivery.verifyLast4(row, last4)) {
      return res.status(403).json({ error: 'verification_required' });
    }
  }

  let rendered;
  try {
    rendered = await renderReportPdf(row.order_id, st.kind, row.client_id);
  } catch (e) {
    console.error('[DELIVERY] render failed', { order: row.order_id, kind: st.kind, err: e.message });
    return res.status(502).json({ error: 'render_failed' });
  }

  delivery.markOpened(row.order_id).catch(() => {});
  delivery.bumpDownloads(row.order_id).catch(() => {});

  res.setHeader('Content-Type', rendered.contentType || 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${rendered.filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.send(rendered.buffer);
}

module.exports = {
  getDeliveryInfo,
  ensureDeliveryLink,
  releaseDelivery,
  unreleaseDelivery,
  patchDeliverySettings,
  internalStatus,
  internalVerify,
  internalFile,
};
