-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "public"."PlanTier" AS ENUM ('FREE', 'STARTER', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "public"."SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'PAUSED', 'CANCELED');

-- CreateEnum
CREATE TYPE "public"."NodeRole" AS ENUM ('INPUT', 'OUTPUT', 'GROUP');

-- CreateEnum
CREATE TYPE "public"."NodeType" AS ENUM ('QUESTION', 'IMAGE', 'VIDEO', 'PDF', 'CODE', 'TEXT', 'EMBED', 'RESPONSE', 'COMMENT', 'NOTES');

-- CreateEnum
CREATE TYPE "public"."EdgeType" AS ENUM ('MANUAL', 'GENERATED', 'REFERENCE', 'PARENT_CHILD');

-- CreateEnum
CREATE TYPE "public"."ConversationStatus" AS ENUM ('PENDING', 'STREAMING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."PrePromptTemplateType" AS ENUM ('SYSTEM', 'USER', 'FEATURE');

-- CreateEnum
CREATE TYPE "public"."CanvasRole" AS ENUM ('OWNER', 'EDITOR', 'COMMENTOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "public"."ShareStatus" AS ENUM ('ACTIVE', 'PENDING', 'REMOVED');

-- CreateEnum
CREATE TYPE "public"."AttachmentType" AS ENUM ('IMAGE', 'PDF', 'CSV', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."DocumentType" AS ENUM ('PDF', 'CSV', 'IMAGE');

-- CreateEnum
CREATE TYPE "public"."DocumentStatus" AS ENUM ('PENDING', 'PROCESSING', 'CHUNKING', 'EMBEDDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."ChunkingStrategy" AS ENUM ('FIXED_SIZE', 'SEMANTIC', 'CSV_ROW', 'PAGE');

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "googleId" TEXT,
    "plan" "public"."PlanTier" NOT NULL DEFAULT 'FREE',
    "status" "public"."SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "stripeId" TEXT,
    "subscriptionId" TEXT,
    "refreshToken" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."canvases" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "boundsMinX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "boundsMinY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "boundsMaxX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "boundsMaxY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "viewportX" DOUBLE PRECISION,
    "viewportY" DOUBLE PRECISION,
    "viewportZoom" DOUBLE PRECISION DEFAULT 1,
    "nodeCount" INTEGER NOT NULL DEFAULT 0,
    "edgeCount" INTEGER NOT NULL DEFAULT 0,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canvases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."nodes" (
    "id" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "clientId" TEXT,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION NOT NULL DEFAULT 360,
    "height" DOUBLE PRECISION NOT NULL DEFAULT 240,
    "zIndex" INTEGER NOT NULL DEFAULT 0,
    "bboxMinX" DOUBLE PRECISION,
    "bboxMinY" DOUBLE PRECISION,
    "bboxMaxX" DOUBLE PRECISION,
    "bboxMaxY" DOUBLE PRECISION,
    "tileIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "role" "public"."NodeRole" NOT NULL DEFAULT 'INPUT',
    "nodeType" "public"."NodeType" NOT NULL,
    "title" VARCHAR(512),
    "content" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "style" JSONB NOT NULL DEFAULT '{}',
    "parentNodeId" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "isCollapsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."edges" (
    "id" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "sourceNodeId" TEXT NOT NULL,
    "targetNodeId" TEXT NOT NULL,
    "edgeType" "public"."EdgeType" NOT NULL DEFAULT 'MANUAL',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "style" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."canvas_shares" (
    "id" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "public"."CanvasRole" NOT NULL DEFAULT 'EDITOR',
    "status" "public"."ShareStatus" NOT NULL DEFAULT 'PENDING',
    "invitedBy" TEXT,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "canvas_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ai_conversations" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "model" VARCHAR(100) NOT NULL,
    "response" TEXT,
    "tokensPrompt" INTEGER,
    "tokensResponse" INTEGER,
    "tokensTotal" INTEGER,
    "costUsd" DECIMAL(10,6),
    "latencyMs" INTEGER,
    "status" "public"."ConversationStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."canvas_snapshots" (
    "id" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "snapshotData" JSONB NOT NULL,
    "nodeCount" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canvas_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."usage_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "costUsd" DECIMAL(10,6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."pre_prompt_templates" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "prompt" TEXT NOT NULL,
    "type" "public"."PrePromptTemplateType" NOT NULL DEFAULT 'SYSTEM',
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pre_prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."attachments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "type" "public"."AttachmentType" NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."documents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "documentType" "public"."DocumentType" NOT NULL,
    "contentHash" TEXT,
    "status" "public"."DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "processingJobId" TEXT,
    "pageCount" INTEGER,
    "rowCount" INTEGER,
    "extractedText" TEXT,
    "ocrConfidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_chunks" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "charCount" INTEGER NOT NULL,
    "pageNumber" INTEGER,
    "rowRange" TEXT,
    "strategy" "public"."ChunkingStrategy" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."chunk_embeddings" (
    "id" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'gemini-embedding-001',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chunk_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."rag_queries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canvasId" TEXT,
    "query" TEXT NOT NULL,
    "retrievedChunkIds" TEXT[],
    "contextText" TEXT,
    "response" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'gemini',
    "model" TEXT NOT NULL DEFAULT 'gemini-2.0-flash-lite',
    "retrievalTimeMs" INTEGER NOT NULL,
    "generationTimeMs" INTEGER NOT NULL,
    "documentIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rag_queries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "public"."users"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "users_stripeId_key" ON "public"."users"("stripeId");

-- CreateIndex
CREATE UNIQUE INDEX "users_subscriptionId_key" ON "public"."users"("subscriptionId");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "public"."users"("email");

-- CreateIndex
CREATE INDEX "users_googleId_idx" ON "public"."users"("googleId");

-- CreateIndex
CREATE INDEX "users_plan_idx" ON "public"."users"("plan");

-- CreateIndex
CREATE INDEX "canvases_userId_updatedAt_idx" ON "public"."canvases"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "canvases_isPublic_idx" ON "public"."canvases"("isPublic");

-- CreateIndex
CREATE INDEX "nodes_canvasId_role_idx" ON "public"."nodes"("canvasId", "role");

-- CreateIndex
CREATE INDEX "nodes_canvasId_nodeType_idx" ON "public"."nodes"("canvasId", "nodeType");

-- CreateIndex
CREATE INDEX "nodes_canvasId_bboxMinX_bboxMaxX_bboxMinY_bboxMaxY_idx" ON "public"."nodes"("canvasId", "bboxMinX", "bboxMaxX", "bboxMinY", "bboxMaxY");

-- CreateIndex
CREATE INDEX "nodes_parentNodeId_idx" ON "public"."nodes"("parentNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "nodes_canvasId_clientId_key" ON "public"."nodes"("canvasId", "clientId");

-- CreateIndex
CREATE INDEX "edges_canvasId_idx" ON "public"."edges"("canvasId");

-- CreateIndex
CREATE INDEX "edges_sourceNodeId_targetNodeId_idx" ON "public"."edges"("sourceNodeId", "targetNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "edges_canvasId_sourceNodeId_targetNodeId_edgeType_key" ON "public"."edges"("canvasId", "sourceNodeId", "targetNodeId", "edgeType");

-- CreateIndex
CREATE INDEX "canvas_shares_userId_idx" ON "public"."canvas_shares"("userId");

-- CreateIndex
CREATE INDEX "canvas_shares_canvasId_idx" ON "public"."canvas_shares"("canvasId");

-- CreateIndex
CREATE UNIQUE INDEX "canvas_shares_canvasId_userId_key" ON "public"."canvas_shares"("canvasId", "userId");

-- CreateIndex
CREATE INDEX "ai_conversations_nodeId_createdAt_idx" ON "public"."ai_conversations"("nodeId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ai_conversations_canvasId_createdAt_idx" ON "public"."ai_conversations"("canvasId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ai_conversations_status_idx" ON "public"."ai_conversations"("status");

-- CreateIndex
CREATE INDEX "canvas_snapshots_canvasId_createdAt_idx" ON "public"."canvas_snapshots"("canvasId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "usage_logs_userId_createdAt_idx" ON "public"."usage_logs"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "usage_logs_resourceType_createdAt_idx" ON "public"."usage_logs"("resourceType", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "pre_prompt_templates_type_idx" ON "public"."pre_prompt_templates"("type");

-- CreateIndex
CREATE INDEX "pre_prompt_templates_userId_idx" ON "public"."pre_prompt_templates"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_key_key" ON "public"."attachments"("key");

-- CreateIndex
CREATE INDEX "attachments_userId_createdAt_idx" ON "public"."attachments"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "attachments_entityType_entityId_idx" ON "public"."attachments"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "attachments_type_idx" ON "public"."attachments"("type");

-- CreateIndex
CREATE UNIQUE INDEX "documents_s3Key_key" ON "public"."documents"("s3Key");

-- CreateIndex
CREATE INDEX "documents_userId_status_idx" ON "public"."documents"("userId", "status");

-- CreateIndex
CREATE INDEX "documents_contentHash_idx" ON "public"."documents"("contentHash");

-- CreateIndex
CREATE INDEX "document_chunks_documentId_idx" ON "public"."document_chunks"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_documentId_chunkIndex_key" ON "public"."document_chunks"("documentId", "chunkIndex");

-- CreateIndex
CREATE UNIQUE INDEX "chunk_embeddings_chunkId_key" ON "public"."chunk_embeddings"("chunkId");

-- CreateIndex
CREATE INDEX "chunk_embeddings_chunkId_idx" ON "public"."chunk_embeddings"("chunkId");

-- CreateIndex
CREATE INDEX "rag_queries_userId_createdAt_idx" ON "public"."rag_queries"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "rag_queries_canvasId_idx" ON "public"."rag_queries"("canvasId");

-- AddForeignKey
ALTER TABLE "public"."canvases" ADD CONSTRAINT "canvases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."nodes" ADD CONSTRAINT "nodes_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "public"."canvases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."nodes" ADD CONSTRAINT "nodes_parentNodeId_fkey" FOREIGN KEY ("parentNodeId") REFERENCES "public"."nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."edges" ADD CONSTRAINT "edges_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "public"."canvases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."edges" ADD CONSTRAINT "edges_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "public"."nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."edges" ADD CONSTRAINT "edges_targetNodeId_fkey" FOREIGN KEY ("targetNodeId") REFERENCES "public"."nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."canvas_shares" ADD CONSTRAINT "canvas_shares_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "public"."canvases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."canvas_shares" ADD CONSTRAINT "canvas_shares_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_conversations" ADD CONSTRAINT "ai_conversations_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "public"."nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_conversations" ADD CONSTRAINT "ai_conversations_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "public"."canvases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."canvas_snapshots" ADD CONSTRAINT "canvas_snapshots_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "public"."canvases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."usage_logs" ADD CONSTRAINT "usage_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pre_prompt_templates" ADD CONSTRAINT "pre_prompt_templates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."attachments" ADD CONSTRAINT "attachments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_chunks" ADD CONSTRAINT "document_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."chunk_embeddings" ADD CONSTRAINT "chunk_embeddings_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "public"."document_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Gemini embedding @ 1536d (pgvector HNSW max 2000): upgrades from 768/3072 (delete rows, resize column).
-- Drop HNSW before ALTER; recreate after. Re-queues completed documents for BullMQ re-embedding.
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
