/**
 * @module controllers/menus.controller
 * @description Read and write a client's tappable WhatsApp menus.
 *
 * A menu is what the customer sees when the assistant emits [[LIST:id]] or
 * [[BUTTONS:id]]. They live in `client_configs.interactive_menus` as a JSON
 * object keyed by id.
 *
 * Validation happens here rather than at send time on purpose: WhatsApp rejects
 * the entire message if a single field is over its limit, and a rejected message
 * is silent from the customer's side. Catching it while someone is editing the
 * menu is the only point where anyone can actually fix it.
 */

'use strict';

const db = require('../db');
const clientRouter = require('../services/clientRouter');
const resolveClientId = require('../middleware/resolveClientId');

/** Meta's per-field limits. Exceeding any one of them drops the whole message. */
const LIMITS = {
  header: 60, body: 1024, footer: 60, button: 20,
  rowTitle: 24, rowDescription: 72, rowId: 200,
  buttonTitle: 20, buttonId: 256,
  sections: 10, rows: 10, buttons: 3,
};

/** Menu ids must match the marker grammar the webhook parses. */
const ID_RE = /^[a-z0-9_]{1,64}$/;

/**
 * Check one menu, returning every problem rather than the first.
 *
 * @param {string} id
 * @param {Object} menu
 * @returns {string[]} human-readable problems, empty when the menu is valid
 */
function validateMenu(id, menu) {
  const errs = [];
  const tooLong = (label, v, max) => {
    if (String(v || '').length > max) errs.push(`${label} is ${String(v).length} characters, over the ${max} limit`);
  };

  if (!ID_RE.test(id)) errs.push(`"${id}" is not a valid id — use lowercase letters, numbers and underscores`);
  if (!menu || typeof menu !== 'object') return [`"${id}" is not a menu`];

  const body = String(menu.body || '').trim();
  if (!body) errs.push('Body text is required');
  tooLong('Body', menu.body, LIMITS.body);
  tooLong('Header', menu.header, LIMITS.header);
  tooLong('Footer', menu.footer, LIMITS.footer);

  const isButtons = Array.isArray(menu.buttons);
  const isList = Array.isArray(menu.sections);
  if (isButtons === isList) return errs.concat('A menu must have either buttons or sections, not both and not neither');

  if (isButtons) {
    if (!menu.buttons.length) errs.push('Add at least one button');
    if (menu.buttons.length > LIMITS.buttons) errs.push(`${menu.buttons.length} buttons — WhatsApp allows ${LIMITS.buttons}`);
    const seen = new Set();
    menu.buttons.forEach((b, i) => {
      if (!String(b.title || '').trim()) errs.push(`Button ${i + 1} needs a label`);
      tooLong(`Button ${i + 1} label`, b.title, LIMITS.buttonTitle);
      tooLong(`Button ${i + 1} id`, b.id, LIMITS.buttonId);
      const key = String(b.id || b.title || '');
      if (seen.has(key)) errs.push(`Two buttons share the id "${key}"`);
      seen.add(key);
    });
  } else {
    if (!String(menu.button || '').trim()) errs.push('The list needs a button label — it is what opens the menu');
    tooLong('List button label', menu.button, LIMITS.button);
    if (menu.sections.length > LIMITS.sections) errs.push(`${menu.sections.length} sections — WhatsApp allows ${LIMITS.sections}`);
    const rows = menu.sections.flatMap(s => (Array.isArray(s.rows) ? s.rows : []));
    if (!rows.length) errs.push('Add at least one row');
    if (rows.length > LIMITS.rows) errs.push(`${rows.length} rows — WhatsApp allows ${LIMITS.rows} across all sections`);
    const seen = new Set();
    menu.sections.forEach((s, si) => {
      tooLong(`Section ${si + 1} title`, s.title, LIMITS.rowTitle);
      (s.rows || []).forEach((r, ri) => {
        const where = `Section ${si + 1} row ${ri + 1}`;
        if (!String(r.title || '').trim()) errs.push(`${where} needs a title`);
        if (!String(r.id || '').trim()) errs.push(`${where} needs an id — it is what identifies the choice`);
        tooLong(`${where} title`, r.title, LIMITS.rowTitle);
        tooLong(`${where} description`, r.description, LIMITS.rowDescription);
        tooLong(`${where} id`, r.id, LIMITS.rowId);
        if (seen.has(r.id)) errs.push(`Two rows share the id "${r.id}"`);
        seen.add(r.id);
      });
    });
  }
  return errs;
}

/**
 * GET /api/menus — this client's menus, plus the limits the editor enforces.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function listMenus(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const { rows } = await db.pgQuery(
      'SELECT interactive_menus FROM client_configs WHERE client_id=$1', [clientId]
    );
    let menus = rows[0]?.interactive_menus || {};
    if (typeof menus === 'string') { try { menus = JSON.parse(menus); } catch { menus = {}; } }
    res.json({ menus, limits: LIMITS });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * PUT /api/menus — replace the whole set.
 *
 * Whole-set rather than per-menu because the assistant's prompt references menus
 * by id: deleting one that a prompt still names would leave the customer with a
 * question and no way to answer it, and that is easier to notice when the full
 * set is in front of you.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function saveMenus(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  const menus = req.body?.menus;
  if (!menus || typeof menus !== 'object' || Array.isArray(menus)) {
    return res.status(400).json({ error: 'menus must be an object keyed by menu id' });
  }

  const errors = {};
  for (const [id, menu] of Object.entries(menus)) {
    const errs = validateMenu(id, menu);
    if (errs.length) errors[id] = errs;
  }
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Some menus would be rejected by WhatsApp', errors });
  }

  try {
    const r = await db.pgQuery(
      'UPDATE client_configs SET interactive_menus=$1, updated_at=NOW() WHERE client_id=$2',
      [JSON.stringify(menus), clientId]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Client not found' });
    clientRouter.invalidateClient?.(clientId);
    res.json({ ok: true, count: Object.keys(menus).length });
  } catch (e) {
    console.error('[MENUS] save error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /api/menus/:id/preview — send one menu to a real number.
 *
 * A menu can only really be judged on a phone. Restricted to the 24-hour window
 * like any interactive message, so the target must have messaged the bot first.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function previewMenu(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  const { id } = req.params;
  const phone = String(req.body?.phone || '').replace(/[^0-9]/g, '');
  if (!phone) return res.status(400).json({ error: 'A phone number is required' });

  try {
    const client = await clientRouter.getClientById(clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const menu = (client.interactive_menus || {})[id];
    if (!menu) return res.status(404).json({ error: `No menu "${id}" — save it before previewing` });

    const { sendWhatsAppInteractiveList, sendWhatsAppReplyButtons } = require('../services/whatsapp');
    const sent = Array.isArray(menu.buttons)
      ? await sendWhatsAppReplyButtons(phone, menu, client)
      : await sendWhatsAppInteractiveList(phone, menu, client);

    if (!sent) {
      return res.status(502).json({
        error: 'WhatsApp rejected the send. The usual cause is the 24-hour window being closed — message the bot from that number first.',
      });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[MENUS] preview error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

module.exports = { listMenus, saveMenus, previewMenu, validateMenu, LIMITS };
