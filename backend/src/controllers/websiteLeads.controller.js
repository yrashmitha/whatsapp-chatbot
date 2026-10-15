'use strict';

const db = require('../db');

const SERVICE_OPTIONS = new Set([
  'AI Sales Assistant',
  'Business Management Software',
  'AI Automation',
  'Custom Web Application',
  'Website / E-commerce',
  'Other',
]);

/**
 * POST /leads
 * Public consultation-request submission from the marketing website.
 */
async function createLead(req, res) {
  const { name, business_name, email, phone, country, service_interest, message } = req.body || {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }
  if (!phone || typeof phone !== 'string' || !phone.trim()) {
    return res.status(400).json({ error: 'A WhatsApp or phone number is required.' });
  }

  const serviceInterest = SERVICE_OPTIONS.has(service_interest) ? service_interest : null;

  const { rows } = await db.pgQuery(
    `INSERT INTO website_leads (name, business_name, email, phone, country, service_interest, message)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
    [
      name.trim().slice(0, 200),
      (business_name || '').trim().slice(0, 200) || null,
      email.trim().slice(0, 200),
      (phone || '').trim().slice(0, 50) || null,
      (country || '').trim().slice(0, 100) || null,
      serviceInterest,
      (message || '').trim().slice(0, 4000) || null,
    ]
  );

  res.status(201).json({ ok: true, id: rows[0].id, created_at: rows[0].created_at });
}

/**
 * GET /api/website-leads — admin listing (jwtAuth protected).
 */
async function listWebsiteLeads(req, res) {
  const { rows } = await db.pgQuery(`SELECT * FROM website_leads ORDER BY created_at DESC LIMIT 500`);
  res.json({ leads: rows });
}

/**
 * GET /api/website-leads/unread-count — badge count for the admin nav tab.
 */
async function unreadCount(req, res) {
  const { rows } = await db.pgQuery(`SELECT COUNT(*)::int AS count FROM website_leads WHERE is_read = false`);
  res.json({ count: rows[0].count });
}

/**
 * PATCH /api/website-leads/:id/read — marks one inquiry as read (viewed).
 */
async function markRead(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  await db.pgQuery(`UPDATE website_leads SET is_read = true WHERE id = $1`, [id]);
  res.json({ ok: true });
}

module.exports = { createLead, listWebsiteLeads, unreadCount, markRead };
