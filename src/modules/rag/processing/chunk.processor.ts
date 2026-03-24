import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from 'prisma/prisma.service';
import { DocumentsGateway } from '../../documents/documents.gateway';
import { ProcessingService } from './processing.service';
import { ChunkingService } from '../chunking/chunking.service';
import { QUEUES, DocumentJobData } from './processing.constants';
import { DocumentStatus } from '@prisma/client';

@Processor(QUEUES.DOCUMENT_CHUNK)
export class ChunkProcessor extends WorkerHost {
  private readonly logger = new Logger(ChunkProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: DocumentsGateway,
    private readonly processingService: ProcessingService,
    private readonly chunkingService: ChunkingService,
  ) {
    super();
  }

  async process(job: Job<DocumentJobData>): Promise<void> {
    const { documentId } = job.data;
    this.logger.log(`[document-chunk] job=${job.id} documentId=${documentId}`);

    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) {
      this.logger.error(`Document ${documentId} not found — skipping`);
      return;
    }

    if (!doc.extractedText) {
      this.logger.warn(`Document ${documentId} has no extracted text — skipping chunking`);
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: DocumentStatus.FAILED, errorMessage: 'No extractable text found' },
      });
      this.gateway.emitFailed(doc.userId, doc.id, doc.filename, 'No extractable text found');
      return;
    }

    try {
      // 1. Chunk the extracted text
      const chunks = this.chunkingService.chunk(doc.extractedText, doc.documentType, {
        pageCount: doc.pageCount ?? undefined,
        mimeType: doc.mimeType,
      });

      this.logger.log(`Document ${documentId}: ${chunks.length} chunks created`);

      // 2. Delete any stale chunks (retry safety)
      await this.prisma.documentChunk.deleteMany({ where: { documentId } });

      // 3. Batch-insert all chunks
      await this.prisma.documentChunk.createMany({
        data: chunks.map((c) => ({
          documentId,
          chunkIndex: c.chunkIndex,
          content: c.content,
          tokenCount: c.tokenCount,
          charCount: c.charCount,
          pageNumber: c.pageNumber ?? null,
          rowRange: c.rowRange ?? null,
          strategy: c.strategy,
        })),
      });

      // 4. Update document status
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: DocumentStatus.EMBEDDING },
      });

      this.gateway.emitChunked(doc.userId, doc.id, doc.filename, chunks.length);

      // 5. Enqueue embedding job (Phase 5 will implement the actual embedding)
      await this.processingService.enqueueEmbedding(documentId);
    } catch (err) {
      this.logger.error(`[document-chunk] Failed for ${documentId}: ${err.message}`, err.stack);
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: DocumentStatus.FAILED, errorMessage: err.message },
      });
      this.gateway.emitFailed(doc.userId, doc.id, doc.filename, err.message);
      throw err;
    }
  }
}
