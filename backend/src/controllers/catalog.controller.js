/**
 * @module controllers/catalog.controller
 * @description Handler for the public product catalog API (no auth required).
 */

'use strict';

const db           = require('../db');
const clientRouter = require('../services/clientRouter');

/**
 * GET /api/catalog/:clientId — return client branding and products grouped by category.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function getPublicCatalog(req, res) {
  const { clientId } = req.params;
  try {
    const client = await clientRouter.getClientById(clientId);
    if (!client || !client.active) return res.status(404).json({ error: 'Client not found' });

    const [productsRes, schemaRes] = await Promise.all([
      db.pgQuery(
        `SELECT id, name, description, price, price_max, currency, category, subcategory, sku, image_url, sort_order, attributes
         FROM client_products WHERE client_id = $1 AND active = TRUE ORDER BY category, sort_order, name`,
        [clientId]
      ),
      db.pgQuery(
        `SELECT field_key, field_label, field_type, options, unit FROM client_attribute_schemas
         WHERE client_id = $1 ORDER BY sort_order`,
        [clientId]
      ),
    ]);

    const products   = productsRes.rows || [];
    const attrSchema = schemaRes.rows   || [];

    // Group products by category
    const categories = {};
    for (const p of products) {
      const cat = p.category || 'General';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(p);
    }

    res.json({
      client: {
        id:         client.id,
        name:       client.brand_name || client.name,
        brand_color: client.brand_color || '#075e54',
        logo_url:   client.logo_url || null,
        phone_number_id: client.phone_number_id || null,
      },
      attrSchema,
      categories,
      totalProducts: products.length,
    });
  } catch (err) {
    console.error(`[CATALOG] Error for ${clientId}:`, err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getPublicCatalog };
