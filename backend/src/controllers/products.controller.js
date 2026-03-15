/**
 * @module controllers/products.controller
 * @description Handlers for CRM product catalog routes
 * (list, get, create, update, delete, bulk import, attributes CRUD).
 */

'use strict';

const db = require('../db');
const { embedText, productToText } = require('../services/embedder');
const resolveClientId = require('../middleware/resolveClientId');

/**
 * GET /api/products — paginated product list with optional search.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function listProducts(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const search = req.query.search || '';
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(200, parseInt(req.query.limit) || 50);
  const offset = (page - 1) * limit;
  try {
    let r, countR;
    if (search) {
      r = await db.pgQuery(
        `SELECT * FROM client_products WHERE client_id=$1 AND (name ILIKE $2 OR description ILIKE $2 OR category ILIKE $2) ORDER BY category, sort_order, name LIMIT $3 OFFSET $4`,
        [clientId, `%${search}%`, limit, offset]
      );
      countR = await db.pgQuery(`SELECT COUNT(*) FROM client_products WHERE client_id=$1 AND (name ILIKE $2 OR description ILIKE $2 OR category ILIKE $2)`, [clientId, `%${search}%`]);
    } else {
      r = await db.pgQuery(`SELECT * FROM client_products WHERE client_id=$1 ORDER BY category, sort_order, name LIMIT $2 OFFSET $3`, [clientId, limit, offset]);
      countR = await db.pgQuery(`SELECT COUNT(*) FROM client_products WHERE client_id=$1`, [clientId]);
    }
    res.json({ products: r.rows, total: parseInt(countR.rows[0].count) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * GET /api/products/:id — get a single product by id.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function getProduct(req, res) {
  try {
    const r = await db.pgQuery(`SELECT * FROM client_products WHERE id=$1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ product: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * POST /api/products — create a new product.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function createProduct(req, res) {
  const clientId = resolveClientId(req);
  const { name, description, price, price_max, currency, category, subcategory, sku, image_url, sort_order, attributes, active } = req.body;
  if (!clientId || !name) return res.status(400).json({ error: 'name required' });
  try {
    const r = await db.pgQuery(
      `INSERT INTO client_products (client_id,name,description,price,price_max,currency,category,subcategory,sku,image_url,sort_order,attributes,active,qty)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [clientId, name, description||null, price||null, price_max||null, currency||'LKR', category||null, subcategory||null, sku||null, image_url||null, sort_order||0, JSON.stringify(attributes||{}), active !== false, parseInt(req.body.qty)||0]
    );
    try { const emb = await embedText(productToText(req.body)); await db.saveProductEmbedding(r.rows[0].id, emb); } catch (_) {}
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * PUT /api/products/:id — update a product.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function updateProduct(req, res) {
  const { name, description, price, price_max, currency, category, subcategory, sku, image_url, sort_order, attributes, active } = req.body;
  try {
    await db.pgQuery(
      `UPDATE client_products SET name=$1,description=$2,price=$3,price_max=$4,currency=$5,category=$6,subcategory=$7,sku=$8,image_url=$9,sort_order=$10,attributes=$11,active=$12,qty=$13,updated_at=NOW() WHERE id=$14`,
      [name, description||null, price||null, price_max||null, currency||'LKR', category||null, subcategory||null, sku||null, image_url||null, sort_order||0, JSON.stringify(attributes||{}), active !== false, parseInt(req.body.qty)||0, req.params.id]
    );
    try { const emb = await embedText(productToText(req.body)); await db.saveProductEmbedding(req.params.id, emb); } catch (_) {}
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * DELETE /api/products/:id — delete a product.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function deleteProduct(req, res) {
  try {
    await db.pgQuery(`DELETE FROM client_products WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * POST /api/products/bulk — bulk import products from JSON array.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function bulkImportProducts(req, res) {
  const clientId = resolveClientId(req);
  const { products } = req.body;
  if (!clientId || !Array.isArray(products)) return res.status(400).json({ error: 'products[] required' });
  let schema = [];
  try { const r = await db.pgQuery(`SELECT field_key FROM client_attribute_schemas WHERE client_id=$1`, [clientId]); schema = r.rows; } catch (_) {}
  const validKeys = new Set(schema.map(s => s.field_key));
  const saved = [], errors = [];
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    if (!p.name) { errors.push(`Row ${i+1}: name required`); continue; }
    if (p.attributes && validKeys.size > 0) {
      const unknown = Object.keys(p.attributes).filter(k => !validKeys.has(k));
      if (unknown.length) { errors.push(`Row ${i+1} (${p.name}): unknown attributes: ${unknown.join(', ')}`); continue; }
    }
    try {
      const r = await db.pgQuery(
        `INSERT INTO client_products (client_id,name,description,price,price_max,currency,category,subcategory,sku,image_url,sort_order,attributes,active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [clientId, p.name, p.description||null, p.price||null, p.price_max||null, p.currency||'LKR', p.category||null, p.subcategory||null, p.sku||null, p.image_url||null, p.sort_order||i, p.attributes ? JSON.stringify(p.attributes) : null, p.active !== false]
      );
      saved.push(r.rows[0].id);
    } catch (e) { errors.push(`Row ${i+1} (${p.name}): ${e.message}`); }
  }
  res.json({ ok: true, saved: saved.length, errors });
}

/**
 * GET /api/attributes — list attribute schemas for a client.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function listAttributes(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const r = await db.pgQuery(`SELECT * FROM client_attribute_schemas WHERE client_id=$1 ORDER BY sort_order`, [clientId]);
    res.json({ attributes: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * POST /api/attributes — create or update an attribute schema field.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function createAttribute(req, res) {
  const clientId = resolveClientId(req);
  const { field_key, field_label, field_type, options, unit, filterable } = req.body;
  if (!clientId || !field_key || !field_label) return res.status(400).json({ error: 'field_key and field_label required' });
  try {
    await db.pgQuery(
      `INSERT INTO client_attribute_schemas (client_id,field_key,field_label,field_type,options,unit,filterable)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (client_id,field_key) DO UPDATE SET field_label=$3,field_type=$4,options=$5,unit=$6,filterable=$7`,
      [clientId, field_key, field_label, field_type||'text', options ? JSON.stringify(options) : null, unit||null, filterable !== false]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * PUT /api/attributes/:id — update an attribute schema field by id.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function updateAttribute(req, res) {
  const { field_label, field_type, options, unit, filterable } = req.body;
  try {
    await db.pgQuery(
      `UPDATE client_attribute_schemas SET field_label=$1,field_type=$2,options=$3,unit=$4,filterable=$5 WHERE id=$6`,
      [field_label, field_type||'text', options ? JSON.stringify(options) : null, unit||null, filterable !== false, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * DELETE /api/attributes/:id — delete an attribute schema field.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function deleteAttribute(req, res) {
  try {
    await db.pgQuery(`DELETE FROM client_attribute_schemas WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * POST /api/attributes/bulk — upsert multiple attribute schema fields.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function bulkImportAttributes(req, res) {
  const clientId = resolveClientId(req);
  const { attributes } = req.body;
  if (!clientId || !Array.isArray(attributes)) return res.status(400).json({ error: 'attributes[] required' });
  const errors = [];
  for (let i = 0; i < attributes.length; i++) {
    const a = attributes[i];
    try {
      await db.pgQuery(
        `INSERT INTO client_attribute_schemas (client_id,field_key,field_label,field_type,options,unit,filterable,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (client_id,field_key) DO UPDATE SET field_label=$3,field_type=$4,options=$5,unit=$6,filterable=$7,sort_order=$8`,
        [clientId, a.field_key, a.field_label, a.field_type||'text', a.options ? JSON.stringify(a.options) : null, a.unit||null, a.filterable !== false, a.sort_order||i]
      );
    } catch (e) { errors.push(`${a.field_key}: ${e.message}`); }
  }
  res.json({ ok: true, saved: attributes.length - errors.length, errors });
}

/**
 * POST /api/upload-image — upload product image to Cloudinary.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function uploadImage(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const crypto = require('crypto');
  const { CLOUDINARY_CLOUD_NAME: cloud, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = process.env;
  if (!cloud || !apiKey || !apiSecret) return res.status(500).json({ error: 'Cloudinary not configured' });
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHash('sha1').update(`folder=products&timestamp=${timestamp}${apiSecret}`).digest('hex');
    const form = new FormData();
    form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
    form.append('folder', 'products');
    form.append('timestamp', String(timestamp));
    form.append('api_key', apiKey);
    form.append('signature', signature);
    const r = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: 'POST', body: form });
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: data.error?.message || 'Cloudinary error' });
    res.json({ url: data.secure_url });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = {
  listProducts, getProduct, createProduct, updateProduct, deleteProduct, bulkImportProducts,
  listAttributes, createAttribute, updateAttribute, deleteAttribute, bulkImportAttributes,
  uploadImage,
};
