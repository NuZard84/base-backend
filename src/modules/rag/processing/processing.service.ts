import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUES, DocumentJobData } from './processing.constants';

@Injectable()
export class ProcessingService {
  private readonly logger = new Logger(ProcessingService.name);

  constructor(
    @Optional() @InjectQueue(QUEUES.DOCUMENT_PROCESS) private readonly processQueue: Queue | null,
    @Optional() @InjectQueue(QUEUES.DOCUMENT_CHUNK) private readonly chunkQueue: Queue | null,
    @Optional() @InjectQueue(QUEUES.DOCUMENT_EMBED) private readonly embedQueue: Queue | null,
  ) {}

  /** Enqueue the initial document-process job. Called from DocumentsService.confirmUpload(). */
  async enqueueProcessing(documentId: string): Promise<string | null> {
    if (!this.processQueue) {
      this.logger.warn(
        'BullMQ queue not available (Redis not configured?). Skipping job enqueue.',
      );
      return null;
    }

    const data: DocumentJobData = { documentId };
    const job = await this.processQueue.add('process', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 50,
    });

    this.logger.log(`Enqueued document-process job=${job.id} for document=${documentId}`);
    return job.id ?? null;
  }

  async enqueueChunking(documentId: string): Promise<void> {
    if (!this.chunkQueue) return;
    await this.chunkQueue.add('chunk', { documentId } satisfies DocumentJobData, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
    });
  }

  async enqueueEmbedding(documentId: string): Promise<void> {
    if (!this.embedQueue) return;
    await this.embedQueue.add('embed', { documentId } satisfies DocumentJobData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 100,
    });
  }
}
