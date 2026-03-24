import { Injectable, Logger } from '@nestjs/common';
import { DocumentType } from '@prisma/client';
import { FixedSizeStrategy } from './strategies/fixed-size.strategy';
import { SemanticStrategy } from './strategies/semantic.strategy';
import { CsvRowStrategy } from './strategies/csv-row.strategy';
import { ChunkInput } from './strategies/chunking-strategy.interface';

@Injectable()
export class ChunkingService {
  private readonly logger = new Logger(ChunkingService.name);

  constructor(
    private readonly fixedSize: FixedSizeStrategy,
    private readonly semantic: SemanticStrategy,
    private readonly csvRow: CsvRowStrategy,
  ) {}

  /**
   * Select the best chunking strategy based on document type and metadata,
   * then split the text into chunks ready for embedding.
   */
  chunk(
    text: string,
    documentType: DocumentType,
    meta: {
      pageCount?: number;
      mimeType?: string;
    } = {},
  ): ChunkInput[] {
    if (!text?.trim()) {
      this.logger.warn(`Empty text passed to ChunkingService for type=${documentType}`);
      return [];
    }

    switch (documentType) {
      case DocumentType.CSV:
        // CSV text was serialised by the worker; re-parse into row chunks
        return this.csvRow.chunk(text);

      case DocumentType.IMAGE:
        // OCR output / description — treat as fixed-size since structure is unknown
        return this.fixedSize.chunk(text);

      case DocumentType.PDF: {
        // Slide-style PDFs (small page count, short text) → page-based via fixed-size
        const avgCharsPerPage = text.length / (meta.pageCount || 1);
        const looksLikeSlides = avgCharsPerPage < 800;

        if (looksLikeSlides) {
          this.logger.debug('PDF looks like slides → FIXED_SIZE strategy');
          return this.fixedSize.chunk(text);
        }

        this.logger.debug('PDF looks text-heavy → SEMANTIC strategy');
        return this.semantic.chunk(text);
      }

      default:
        return this.fixedSize.chunk(text);
    }
  }
}
