import { Injectable, Logger } from '@nestjs/common';
import { ParsedFileContent } from '../../ai-model-api/providers/ai-provider.interface';

@Injectable()
export class ImageParser {
  private readonly logger = new Logger(ImageParser.name);

  /**
   * For images we don't extract text — the buffer is passed directly
   * to multimodal AI providers (e.g. Gemini vision, GPT-4o).
   */
  async parse(buffer: Buffer, filename: string, mimeType: string): Promise<ParsedFileContent> {
    this.logger.log(`Prepared image for multimodal parsing: ${filename} (${mimeType})`);
    return {
      buffer,
      mimeType,
      filename,
      fileType: 'IMAGE',
      meta: {
        sizeBytes: buffer.length,
      },
    };
  }
}
