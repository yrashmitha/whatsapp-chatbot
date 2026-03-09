'use strict';
// ─── scripts/import-products.js ──────────────────────────────────────────────
// Imports products from a JSON file into client_products table.
//
// Usage:
//   node scripts/import-products.js royal_note products-royal-note.json
//   node scripts/import-products.js royal_note products-royal-note.json --clear
//
// --clear flag: deletes all existing products for that client first
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs   = require('fs');
const path = require('path');
const db   = require('../db');

async function run() {
  const [clientId, filename] = process.argv.slice(2);
  const clearFirst = process.argv.includes('--clear');

  if (!clientId || !filename) {
    console.error('Usage: node import-products.js <client_id> <json_file> [--clear]');
    process.exit(1);
  }

  if (!db.IS_PG) {
    console.error('This script requires PostgreSQL (DATABASE_URL not set).');
    process.exit(1);
  }

  await db.init();

  const filePath = path.isAbsolute(filename)
    ? filename
    : path.join(__dirname, filename);

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const products = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  console.log(`Loaded ${products.length} products from ${filename}`);

  if (clearFirst) {
    await db.pgQuery('DELETE FROM client_products WHERE client_id=$1', [clientId]);
    console.log(`Cleared existing products for client: ${clientId}`);
  }

  let inserted = 0, skipped = 0;

  for (const p of products) {
    const name        = (p.name || '').trim();
    const description = (p.description || '').trim();
    const price       = parseFloat(p.price) || 0;
    const priceMax    = p.price_max ? parseFloat(p.price_max) : null;
    const currency    = (p.currency || 'LKR').trim();
    const category    = (p.category || '').trim() || null;
    const subcategory = (p.subcategory || '').trim() || null;
    const sku         = (p.sku || '').trim() || null;
    const imageUrl    = (p.image_url || '').trim() || null;
    const sortOrder   = parseInt(p.sort_order) || 0;
    const attributes  = p.attributes && typeof p.attributes === 'object'
      ? JSON.stringify(p.attributes)
      : '{}';

    if (!name) { console.warn('  [SKIP] Empty name, skipping row'); skipped++; continue; }

    try {
      await db.pgQuery(`
        INSERT INTO client_products
          (client_id, name, description, price, price_max, currency, category, subcategory, sku, image_url, sort_order, attributes, active,
           search_vec)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,true,
          to_tsvector('english',
            coalesce($2,'') || ' ' || coalesce($3,'') || ' ' || coalesce($9,'') || ' ' || coalesce($7,'') || ' ' || $12
          ))
        ON CONFLICT (client_id, sku) DO UPDATE SET
          name        = EXCLUDED.name,
          description = EXCLUDED.description,
          price       = EXCLUDED.price,
          price_max   = EXCLUDED.price_max,
          currency    = EXCLUDED.currency,
          category    = EXCLUDED.category,
          subcategory = EXCLUDED.subcategory,
          image_url   = EXCLUDED.image_url,
          attributes  = EXCLUDED.attributes,
          search_vec  = EXCLUDED.search_vec,
          updated_at  = NOW()
      `, [clientId, name, description, price, priceMax, currency, category, subcategory, sku, imageUrl, sortOrder, attributes]);

      console.log(`  [${++inserted}] ✓ ${name}`);
    } catch (e) {
      console.error(`  [FAIL] ${name}: ${e.message}`);
      skipped++;
    }
  }

  console.log(`\nDone. ${inserted} inserted/updated, ${skipped} skipped.`);
  console.log(`\nNext step: generate embeddings:`);
  console.log(`  node scripts/backfill-embeddings.js`);

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
