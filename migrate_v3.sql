-- ============================================================
-- migrate_v3.sql  —  pgvector RAG support
-- Safe to run multiple times (fully idempotent)
-- Run AFTER migrate_v2.sql
-- ============================================================

BEGIN;

-- Enable pgvector (Railway Postgres has this built in)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add 768-dim embedding column to client_products (Google text-embedding-004)
ALTER TABLE client_products
  ADD COLUMN IF NOT EXISTS embedding VECTOR(768);

-- HNSW index for fast approximate cosine similarity search
CREATE INDEX IF NOT EXISTS idx_products_embedding
  ON client_products USING hnsw (embedding vector_cosine_ops);

COMMIT;

-- Verify:
--   SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
--   SELECT column_name, data_type FROM information_schema.columns
--     WHERE table_name = 'client_products' AND column_name = 'embedding';
