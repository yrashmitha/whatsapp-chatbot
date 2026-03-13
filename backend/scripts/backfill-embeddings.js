'use strict';
// ─── scripts/backfill-embeddings.js ──────────────────────────────────────────
// One-time script: generates and saves embeddings for all products that
// don't have one yet. Run after deploying RAG support.
//
// Usage: node scripts/backfill-embeddings.js
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const db               = require('../db');
const { embedText, productToText } = require('../embedder');

async function run() {
  await db.init();

  if (!db.IS_PG) {
    console.error('This script requires a PostgreSQL database (DATABASE_URL not set).');
    process.exit(1);
  }

  const { rows } = await db.pgQuery(
    `SELECT id, name, description, category, subcategory, sku, attributes
     FROM client_products WHERE active = TRUE AND embedding IS NULL
     ORDER BY id`
  );

  if (rows.length === 0) {
    console.log('All products already have embeddings.');
    process.exit(0);
  }

  console.log(`Embedding ${rows.length} products...`);
  let ok = 0, fail = 0;

  for (const p of rows) {
    try {
      const emb = await embedText(productToText(p));
      await db.saveProductEmbedding(p.id, emb);
      console.log(`  [${++ok}/${rows.length}] ✓ id=${p.id}: ${p.name}`);
    } catch (e) {
      console.error(`  [FAIL] id=${p.id}: ${e.message}`);
      fail++;
    }
  }

  console.log(`\nDone. ${ok} embedded, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
