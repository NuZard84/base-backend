import { Injectable, Logger } from '@nestjs/common';
import { ParsedFileContent } from '../../ai-model-api/providers/ai-provider.interface';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');

@Injectable()
export class PdfParser {
  private readonly logger = new Logger(PdfParser.name);

  async parse(buffer: Buffer, filename: string): Promise<ParsedFileContent> {
    this.logger.log(`Parsing PDF: ${filename}`);
    try {
      const data = await pdfParse(buffer);
      return {
        text: data.text,
        buffer,
        mimeType: 'application/pdf',
        filename,
        fileType: 'PDF',
        meta: {
          pageCount: data.numpages,
          info: data.info,
        },
      };
    } catch (err) {
      this.logger.error(`Failed to parse PDF "${filename}": ${err.message}`);
      throw new Error(`PDF parsing failed: ${err.message}`);
    }
  }
}
