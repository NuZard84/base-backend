import { Injectable, Logger } from '@nestjs/common';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Point pdfjs to its own worker file so it can parse in a background thread
pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve(
  'pdfjs-dist/legacy/build/pdf.worker.mjs',
);

export interface PdfResult {
  text: string;
  pageCount: number;
}

@Injectable()
export class PdfProcessorHelper {
  private readonly logger = new Logger(PdfProcessorHelper.name);

  async extract(buffer: Buffer, filename: string): Promise<PdfResult> {
    this.logger.log(`Extracting text from PDF: ${filename}`);

    const data = new Uint8Array(buffer);
    const doc = await pdfjsLib.getDocument({ data }).promise;

    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((item: any) => item.str).join(' '));
    }

    await doc.destroy();

    return {
      text: pages.join('\n'),
      pageCount: doc.numPages,
    };
  }
}
