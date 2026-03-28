-- HNSW index for fast vector similarity search on chunk_embeddings
-- Run after: npx prisma db push (or via npm run prisma:push)
CREATE INDEX IF NOT EXISTS chunk_embeddings_embedding_hnsw_idx
  ON chunk_embeddings
  USING hnsw (embedding vector_cosine_ops);
