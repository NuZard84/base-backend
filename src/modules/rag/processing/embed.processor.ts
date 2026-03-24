import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from 'prisma/prisma.service';
import { DocumentsGateway } from '../../documents/documents.gateway';
import { EmbeddingsService, EMBEDDING_MODEL } from '../embeddings/embeddings.service';
import { QUEUES, DocumentJobData } from './processing.constants';
import { DocumentStatus } from '@prisma/client';
import { randomUUID } from 'crypto';

@Processor(QUEUES.DOCUMENT_EMBED)
export class EmbedProcessor extends WorkerHost {
  private readonly logger = new Logger(EmbedProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: DocumentsGateway,
    private readonly embeddingsService: EmbeddingsService,
  ) {
    super();
  }

  async process(job: Job<DocumentJobData>): Promise<void> {
    const { documentId } = job.data;
    this.logger.log(`[document-embed] job=${job.id} documentId=${documentId}`);

    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) {
      this.logger.error(`Document ${documentId} not found — skipping`);
      return;
    }

    try {
      // 1. Load all chunks that don't yet have an embedding
      const chunks = await this.prisma.documentChunk.findMany({
        where: {
          documentId,
          embedding: null, // only unembedded chunks
        },
        orderBy: { chunkIndex: 'asc' },
      });

      if (chunks.length === 0) {
        this.logger.warn(`No unembedded chunks for document ${documentId}`);
        await this.markCompleted(doc, 0);
        return;
      }

      this.logger.log(`Embedding ${chunks.length} chunks for document ${documentId}`);

      // 2. Batch-embed all chunk contents
      const texts = chunks.map((c) => c.content);
      const results = await this.embeddingsService.embedBatch(texts, 'RETRIEVAL_DOCUMENT');

      // 3. Persist ALL embeddings atomically — if any insert fails, none are committed.
      //    This prevents partial-embedding state that would be silently skipped on retry.
      await this.prisma.$transaction(async (tx) => {
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const vectorLiteral = `[${results[i].embedding.join(',')}]`;

          await tx.$executeRaw`
            INSERT INTO chunk_embeddings (id, "chunkId", embedding, model, "createdAt")
            VALUES (
              ${randomUUID()},
              ${chunk.id},
              ${vectorLiteral}::vector,
              ${EMBEDDING_MODEL},
              NOW()
            )
            ON CONFLICT ("chunkId")
            DO UPDATE SET
              embedding = ${vectorLiteral}::vector,
              model     = ${EMBEDDING_MODEL}
          `;
        }
      });

      const cacheHits = results.filter((r) => r.fromCache).length;
      this.logger.log(
        `Stored ${chunks.length} embeddings for document ${documentId} ` +
        `(${cacheHits} from cache, ${chunks.length - cacheHits} fresh)`,
      );

      await this.markCompleted(doc, chunks.length);
    } catch (err) {
      this.logger.error(`[document-embed] Failed for ${documentId}: ${err.message}`, err.stack);
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: DocumentStatus.FAILED, errorMessage: err.message },
      });
      this.gateway.emitFailed(doc.userId, doc.id, doc.filename, err.message);
      throw err;
    }
  }

  private async markCompleted(doc: { id: string; userId: string; filename: string }, chunkCount: number) {
    await this.prisma.document.update({
      where: { id: doc.id },
      data: { status: DocumentStatus.COMPLETED },
    });
    this.gateway.emitReady(doc.userId, doc.id, doc.filename, chunkCount);
    this.logger.log(`Document ${doc.id} → COMPLETED (${chunkCount} chunks embedded)`);
  }
}
