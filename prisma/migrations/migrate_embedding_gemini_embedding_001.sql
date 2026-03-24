-- Run ONCE on Neon (or any DB still on vector(768)) — e.g. SQL Editor or:
--   npx prisma db execute --file prisma/migrations/migrate_embedding_gemini_embedding_001.sql --schema prisma/schema.prisma
--
-- Same block as the end of 20250324120000_baseline/migration.sql. Baseline was
-- marked applied without executing on existing DBs, so run this manually to match
-- gemini-embedding-001 @ 1536d (pgvector HNSW max 2000 dimensions).

DROP INDEX IF EXISTS "public"."chunk_embeddings_embedding_hnsw_idx";

DELETE FROM "public"."chunk_embeddings";

ALTER TABLE "public"."chunk_embeddings"
  ALTER COLUMN "embedding" TYPE vector(1536);

CREATE INDEX "chunk_embeddings_embedding_hnsw_idx"
  ON "public"."chunk_embeddings"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

UPDATE "public"."documents"
  SET "status" = 'CHUNKING'::"public"."DocumentStatus"
  WHERE "status" = 'COMPLETED'::"public"."DocumentStatus";
