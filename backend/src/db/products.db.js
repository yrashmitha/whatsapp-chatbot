/**
 * @module db/products.db
 * @description Database access layer for the client_products and
 * client_attribute_schemas tables.
 * Abstracts over PostgreSQL (production) and SQLite (local dev).
 */

'use strict';

const { pool, db, IS_PG } = require('./connection');

/**
 * Full-text search across client products.
 * Falls back to a simple LIKE search on SQLite.
 *
 * @param {string}      clientId  - Multi-tenant client ID
 * @param {string}      query     - Search query string
 * @param {number}      [limit]   - Maximum number of results
 * @param {number|null} [maxPrice]- Optional price ceiling
 * @returns {Promise<Array>} Array of product row objects
 */
async function searchProducts(clientId, query, limit = 10, maxPrice = null) {
  if (IS_PG) {
    if (!query || !query.trim()) {
      const params = [clientId, limit];
      let priceClause = '';
      if (maxPrice != null) { priceClause = `AND price <= $3`; params.push(maxPrice); }
      const res = await pool.query(
        `SELECT id, name, description, price, price_max, currency, category, subcategory, sku, image_url, attributes
         FROM client_products WHERE client_id = $1 AND active = TRUE ${priceClause}
         ORDER BY sort_order, name LIMIT $2`,
        params
      );
      return res.rows;
    }
    const params = [clientId, query.trim(), limit];
    let priceClause = '';
    if (maxPrice != null) { priceClause = `AND price <= $4`; params.push(maxPrice); }
    const res = await pool.query(
      `SELECT id, name, description, price, price_max, currency, category, subcategory, sku, image_url, attributes,
              ts_rank(search_vec, plainto_tsquery('english', $2)) AS rank
       FROM client_products WHERE client_id = $1 AND active = TRUE
         AND search_vec @@ plainto_tsquery('english', $2)
         ${priceClause}
       ORDER BY rank DESC, sort_order LIMIT $3`,
      params
    );
    return res.rows;
  } else {
    // SQLite: simple LIKE search
    const q = query ? `%${query.trim()}%` : null;
    const priceFilter = maxPrice != null ? `AND price <= ?` : '';
    const priceParam = maxPrice != null ? [maxPrice] : [];
    const rows = q
      ? db.prepare(`SELECT id, name, description, price, price_max, currency, category, subcategory, sku, image_url, attributes
                    FROM client_products WHERE client_id = ? AND active = 1
                    AND (name LIKE ? OR description LIKE ? OR category LIKE ?) ${priceFilter} ORDER BY sort_order, name LIMIT ?`)
           .all(clientId, q, q, q, ...priceParam, limit)
      : db.prepare(`SELECT id, name, description, price, price_max, currency, category, subcategory, sku, image_url, attributes
                    FROM client_products WHERE client_id = ? AND active = 1 ${priceFilter} ORDER BY sort_order, name LIMIT ?`)
           .all(clientId, ...priceParam, limit);
    return rows.map(r => ({ ...r, attributes: JSON.parse(r.attributes || '{}') }));
  }
}

/**
 * Vector (cosine similarity) search across client products using pgvector.
 * Returns an empty array on SQLite (pgvector is not available).
 *
 * @param {string}      clientId  - Multi-tenant client ID
 * @param {number[]}    embedding - Query embedding vector (768 dimensions)
 * @param {number}      [limit]   - Maximum number of results
 * @param {number|null} [maxPrice]- Optional price ceiling
 * @returns {Promise<Array>} Array of product row objects with similarity score
 */
async function vectorSearchProducts(clientId, embedding, limit = 10, maxPrice = null) {
  if (!IS_PG) return []; // pgvector not available on SQLite
  const params = [clientId, JSON.stringify(embedding), limit];
  let priceClause = '';
  if (maxPrice != null) { priceClause = `AND price <= $4`; params.push(maxPrice); }
  const res = await pool.query(
    `SELECT id, name, description, price, price_max, currency,
            category, subcategory, sku, image_url, attributes,
            1 - (embedding <=> $2::vector) AS similarity
     FROM client_products
     WHERE client_id = $1 AND active = TRUE AND embedding IS NOT NULL
       AND (1 - (embedding <=> $2::vector)) > 0.5
       ${priceClause}
     ORDER BY embedding <=> $2::vector
     LIMIT $3`,
    params
  );
  return res.rows;
}

/**
 * Persist an embedding vector for a product row.
 * No-op on SQLite.
 *
 * @param {number}   productId - client_products primary key
 * @param {number[]} embedding - Embedding vector (768 dimensions)
 * @returns {Promise<void>}
 */
async function saveProductEmbedding(productId, embedding) {
  if (!IS_PG) return;
  await pool.query(
    `UPDATE client_products SET embedding = $1::vector WHERE id = $2`,
    [JSON.stringify(embedding), productId]
  );
}

/**
 * Return the attribute schema (field definitions) for a client's product catalog.
 *
 * @param {string} clientId - Multi-tenant client ID
 * @returns {Promise<Array>} Array of attribute schema rows
 */
async function getAttributeSchema(clientId) {
  if (IS_PG) {
    const res = await pool.query(
      `SELECT field_key, field_label, field_type, options, unit, filterable
       FROM client_attribute_schemas WHERE client_id = $1 ORDER BY sort_order`,
      [clientId]
    );
    return res.rows;
  } else {
    const rows = db.prepare(
      `SELECT field_key, field_label, field_type, options, unit, filterable
       FROM client_attribute_schemas WHERE client_id = ? ORDER BY sort_order`
    ).all(clientId);
    return rows.map(r => ({ ...r, options: r.options ? JSON.parse(r.options) : null }));
  }
}

module.exports = { searchProducts, vectorSearchProducts, saveProductEmbedding, getAttributeSchema };
