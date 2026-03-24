import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from 'prisma/prisma.service';
import { S3Service } from '../../attachments/s3.service';
import { DocumentsGateway } from '../../documents/documents.gateway';
import { ProcessingService } from './processing.service';
import { PdfProcessorHelper } from './processors/pdf.processor';
import { CsvProcessorHelper } from './processors/csv.processor';
import { ImageProcessorHelper } from './processors/image.processor';
import { QUEUES, DocumentJobData } from './processing.constants';
import { DocumentStatus, DocumentType } from '@prisma/client';

const PREVIEW_MAX_BYTES = 50 * 1024; // 50 KB stored in DB for preview

/** PostgreSQL `text` rejects U+0000 (0x00); strip so extraction can still be stored. */
function stripNulBytes(s: string): string {
  return s.includes('\0') ? s.replace(/\0/g, '') : s;
}

@Processor(QUEUES.DOCUMENT_PROCESS)
export class DocumentProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly gateway: DocumentsGateway,
    private readonly processingService: ProcessingService,
    private readonly pdfHelper: PdfProcessorHelper,
    private readonly csvHelper: CsvProcessorHelper,
    private readonly imageHelper: ImageProcessorHelper,
  ) {
    super();
  }

  async process(job: Job<DocumentJobData>): Promise<void> {
    const { documentId } = job.data;
    this.logger.log(`[document-process] job=${job.id} documentId=${documentId}`);

    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) {
      this.logger.error(`Document ${documentId} not found — skipping`);
      return;
    }

    // Notify frontend
    this.gateway.emitProcessingStarted(doc.userId, doc.id, doc.filename);

    try {
      // 1. Download from S3
      const buffer = await this.s3.getBuffer(doc.s3Key);

      // 2. Extract text based on document type
      let extractedText = '';
      let pageCount: number | undefined;
      let rowCount: number | undefined;
      let ocrConfidence: number | undefined;

      switch (doc.documentType) {
        case DocumentType.PDF: {
          const result = await this.pdfHelper.extract(buffer, doc.filename);
          extractedText = result.text;
          pageCount = result.pageCount;
          break;
        }
        case DocumentType.CSV: {
          const result = await this.csvHelper.extract(buffer, doc.filename);
          // Store raw CSV so CsvRowStrategy can re-parse it with Papa.parse.
          // The formatted `result.text` is only for human display, not for chunking.
          extractedText = buffer.toString('utf-8');
          rowCount = result.rowCount;
          break;
        }
        case DocumentType.IMAGE: {
          const result = await this.imageHelper.extract(buffer, doc.mimeType, doc.filename);
          extractedText = result.text;
          ocrConfidence = result.ocrConfidence;
          break;
        }
      }

      extractedText = stripNulBytes(extractedText);

      // 3. Persist extraction results
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: DocumentStatus.CHUNKING,
          extractedText: extractedText.slice(0, PREVIEW_MAX_BYTES),
          pageCount: pageCount ?? null,
          rowCount: rowCount ?? null,
          ocrConfidence: ocrConfidence ?? null,
        },
      });

      this.logger.log(
        `Extraction done for ${documentId}: ${extractedText.length} chars, pages=${pageCount}, rows=${rowCount}`,
      );

      // 4. Hand off to chunking queue
      await this.processingService.enqueueChunking(documentId);
    } catch (err) {
      this.logger.error(`[document-process] Failed for ${documentId}: ${err.message}`, err.stack);
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: DocumentStatus.FAILED, errorMessage: err.message },
      });
      this.gateway.emitFailed(doc.userId, doc.id, doc.filename, err.message);
      throw err; // Let BullMQ retry
    }
  }
}
