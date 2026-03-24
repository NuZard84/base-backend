import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ParsedFileContent } from '../../ai-model-api/providers/ai-provider.interface';
import { PdfParser } from './pdf.parser';
import { CsvParser } from './csv.parser';
import { ImageParser } from './image.parser';

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

const CSV_MIME_TYPES = new Set([
  'text/csv',
  'application/csv',
  'text/plain',
]);

@Injectable()
export class FileParserService {
  private readonly logger = new Logger(FileParserService.name);

  constructor(
    private readonly pdfParser: PdfParser,
    private readonly csvParser: CsvParser,
    private readonly imageParser: ImageParser,
  ) {}

  async parse(
    buffer: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<ParsedFileContent> {
    this.logger.log(`Dispatching parser for: ${filename} [${mimeType}]`);

    if (mimeType === 'application/pdf') {
      return this.pdfParser.parse(buffer, filename);
    }

    if (CSV_MIME_TYPES.has(mimeType) || filename.toLowerCase().endsWith('.csv')) {
      return this.csvParser.parse(buffer, filename);
    }

    if (IMAGE_MIME_TYPES.has(mimeType)) {
      return this.imageParser.parse(buffer, filename, mimeType);
    }

    throw new BadRequestException(
      `Unsupported file type "${mimeType}" for summarization. Supported: PDF, CSV, images (jpeg, png, gif, webp).`,
    );
  }
}
