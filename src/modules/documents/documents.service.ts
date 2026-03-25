import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { S3Service } from '../attachments/s3.service';
import { ProcessingService } from '../rag/processing/processing.service';
import { CreatePresignedUrlDto } from './dto/create-presigned-url.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { DocumentType, DocumentStatus } from '@prisma/client';
import * as path from 'path';

/** Maps MIME type → DocumentType enum */
const MIME_TO_DOCUMENT_TYPE: Record<string, DocumentType> = {
  'application/pdf': DocumentType.PDF,
  'text/csv': DocumentType.CSV,
  'application/csv': DocumentType.CSV,
  'text/plain': DocumentType.CSV,
  'image/jpeg': DocumentType.IMAGE,
  'image/png': DocumentType.IMAGE,
  'image/gif': DocumentType.IMAGE,
  'image/webp': DocumentType.IMAGE,
};

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly processingService: ProcessingService,
  ) {}

  /**
   * Phase 1 of the upload flow.
   * Creates a Document record in PENDING state and returns a presigned S3 PUT URL
   * so the browser can upload the file directly to S3.
   */
  async createPresignedUrl(userId: string, dto: CreatePresignedUrlDto) {
    const documentType = MIME_TO_DOCUMENT_TYPE[dto.mimeType];
    if (!documentType) {
      throw new BadRequestException(`Unsupported MIME type: ${dto.mimeType}`);
    }

    const ext = path.extname(dto.filename) || this.mimeToExtension(dto.mimeType);
    const s3Key = this.buildS3Key(userId, documentType, ext);

    const document = await this.prisma.document.create({
      data: {
        userId,
        canvasId: dto.canvasId ?? null,
        filename: dto.filename,
        s3Key,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        documentType,
        status: DocumentStatus.PENDING,
      },
    });

    const uploadUrl = await this.s3.getPresignedPutUrl({
      key: s3Key,
      contentType: dto.mimeType,
      expiresIn: 300, // 5 minutes
    });

    this.logger.log(`Presigned upload URL created for document=${document.id} user=${userId}`);

    return {
      documentId: document.id,
      uploadUrl,
      s3Key,
      expiresInSeconds: 300,
    };
  }

  /**
   * Phase 2 of the upload flow.
   * Called after the browser finishes uploading to S3.
   * Marks the document as PROCESSING and will enqueue a BullMQ job (Phase 3).
   */
  async confirmUpload(userId: string, dto: ConfirmUploadDto) {
    const document = await this.findOwnedDocument(userId, dto.documentId);

    if (document.status !== DocumentStatus.PENDING) {
      throw new BadRequestException(
        `Document is already in "${document.status}" state. Cannot re-confirm.`,
      );
    }

    // Verify the file actually landed in S3
    const exists = await this.s3.exists(document.s3Key);
    if (!exists) {
      throw new BadRequestException(
        'File not found in storage. Please upload the file before confirming.',
      );
    }

    const updated = await this.prisma.document.update({
      where: { id: document.id },
      data: {
        status: DocumentStatus.PROCESSING,
        contentHash: dto.contentHash ?? null,
      },
    });

    // Enqueue the BullMQ processing pipeline
    const jobId = await this.processingService.enqueueProcessing(document.id);

    // Store the job ID for idempotency tracking
    if (jobId) {
      await this.prisma.document.update({
        where: { id: document.id },
        data: { processingJobId: jobId },
      });
    }

    this.logger.log(`Upload confirmed for document=${document.id} — jobId=${jobId ?? 'none (Redis unavailable)'}`);

    return {
      documentId: updated.id,
      status: updated.status,
      jobId: jobId ?? null,
      message: 'Upload confirmed. Processing will begin shortly.',
    };
  }

  async findAll(userId: string, status?: DocumentStatus, canvasId?: string) {
    const where: any = { userId };
    if (status) where.status = status;

    if (canvasId) {
      // Canvas scope: show global (null) docs + this canvas's own docs
      where.OR = [{ canvasId: null }, { canvasId }];
    } else {
      // RagChat / global scope: show only null-canvasId docs
      where.canvasId = null;
    }

    const documents = await this.prisma.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { chunks: true } },
      },
    });

    return documents.map((doc) => this.formatDocument(doc));
  }

  async findOne(userId: string, id: string) {
    const document = await this.findOwnedDocument(userId, id);

    const full = await this.prisma.document.findUnique({
      where: { id },
      include: {
        chunks: {
          select: {
            id: true,
            chunkIndex: true,
            tokenCount: true,
            charCount: true,
            pageNumber: true,
            rowRange: true,
            strategy: true,
            embedding: { select: { id: true, model: true } },
          },
          orderBy: { chunkIndex: 'asc' },
        },
        _count: { select: { chunks: true } },
      },
    });

    return this.formatDocument(full);
  }

  async remove(userId: string, id: string) {
    const doc = await this.findOwnedDocument(userId, id);

    await this.s3.delete(doc.s3Key);

    await this.prisma.document.delete({ where: { id } });

    this.logger.log(`Deleted document=${id} and S3 key=${doc.s3Key} for user=${userId}`);
    return { id, deleted: true };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private async findOwnedDocument(userId: string, id: string) {
    const document = await this.prisma.document.findUnique({ where: { id } });
    if (!document) throw new NotFoundException(`Document "${id}" not found`);
    if (document.userId !== userId) throw new ForbiddenException('Access denied');
    return document;
  }

  private formatDocument(doc: any) {
    const { contentHash, processingJobId, s3Key, ...rest } = doc;
    return rest;
  }

  private buildS3Key(userId: string, type: DocumentType, ext: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 10);
    const safeExt = ext.startsWith('.') ? ext : `.${ext}`;
    return `documents/${userId}/${type.toLowerCase()}/${timestamp}-${random}${safeExt}`;
  }

  private mimeToExtension(mimeType: string): string {
    const map: Record<string, string> = {
      'application/pdf': '.pdf',
      'text/csv': '.csv',
      'application/csv': '.csv',
      'text/plain': '.txt',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
    };
    return map[mimeType] ?? '';
  }
}
