import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { EmbeddingsService } from '../embeddings/embeddings.service';

export interface VectorSearchResult {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  pageNumber: number | null;
  rowRange: string | null;
  similarity: number;
  documentFilename: string;
}

export interface VectorSearchOptions {
  /** Top-K chunks to return */
  limit?: number;
  /** Minimum cosine similarity threshold (0–1). Default: 0.35 */
  similarityThreshold?: number;
  /** Restrict search to specific document IDs */
  documentIds?: string[];
  /** Restrict search to a specific user's documents */
  userId?: string;
}

type RawRow = {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  pageNumber: number | null;
  rowRange: string | null;
  similarity: number;
  filename: string;
};

@Injectable()
export class VectorSearchService {
  private readonly logger = new Logger(VectorSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  /**
   * Embed the query and find the top-K most similar document chunks.
   * Uses pgvector HNSW index for fast cosine similarity search.
   */
  async search(query: string, options: VectorSearchOptions = {}): Promise<VectorSearchResult[]> {
    const queryVector = await this.embeddings.embedOne(query, 'RETRIEVAL_QUERY');
    const threshold = options.similarityThreshold ?? 0.35;
    this.logger.debug(
      `Vector search: "${query.slice(0, 80)}" limit=${options.limit ?? 10} threshold=${threshold}`,
    );
    return this.searchByVector(queryVector, { ...options, similarityThreshold: threshold });
  }

  /**
   * Search using an already-computed query vector — avoids re-calling Gemini.
   */
  async searchByVector(
    queryVector: number[],
    options: VectorSearchOptions = {},
  ): Promise<VectorSearchResult[]> {
    const {
      limit = 10,
      similarityThreshold = 0.35,
      documentIds,
      userId,
    } = options;

    const vectorLiteral = `[${queryVector.join(',')}]`;

    // Build optional filter fragments — appended to the base WHERE clause.
    // All values are passed as Prisma.sql parameters to prevent injection.
    const filters: Prisma.Sql[] = [
      Prisma.sql`(1 - (ce.embedding <=> ${vectorLiteral}::vector)) >= ${similarityThreshold}`,
    ];

    if (userId) {
      filters.push(Prisma.sql`d."userId" = ${userId}`);
    }
    if (documentIds && documentIds.length > 0) {
      filters.push(Prisma.sql`dc."documentId" = ANY(${documentIds}::text[])`);
    }

    const whereClause = Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}`;

    const rows = await this.prisma.$queryRaw<RawRow[]>`
      SELECT
        dc.id                                                              AS "chunkId",
        dc."documentId",
        dc."chunkIndex",
        dc.content,
        dc."pageNumber",
        dc."rowRange",
        d.filename,
        (1 - (ce.embedding <=> ${vectorLiteral}::vector))::float          AS similarity
      FROM chunk_embeddings ce
      JOIN document_chunks  dc ON ce."chunkId"    = dc.id
      JOIN documents         d ON dc."documentId" = d.id
      ${whereClause}
      ORDER BY ce.embedding <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `;

    if (rows.length > 0) {
      const scores = rows.map((r) => Number(r.similarity).toFixed(3));
      this.logger.debug(`Vector search returned ${rows.length} results — similarities: [${scores.join(', ')}]`);
    } else {
      this.logger.debug('Vector search returned 0 results (all below threshold)');
    }

    return rows.map((r) => ({
      chunkId: r.chunkId,
      documentId: r.documentId,
      chunkIndex: r.chunkIndex,
      content: r.content,
      pageNumber: r.pageNumber,
      rowRange: r.rowRange,
      similarity: Number(r.similarity),
      documentFilename: r.filename,
    }));
  }

  /** Pre-embed a query string without running the search. */
  async embedQuery(query: string): Promise<number[]> {
    return this.embeddings.embedOne(query, 'RETRIEVAL_QUERY');
  }
}
