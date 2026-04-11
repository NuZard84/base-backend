import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import { pathToFileURL } from 'url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Point pdfjs to its own worker file so it can parse in a background thread
// Use pathToFileURL to convert filesystem path to ESM-compatible file:// URL
pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(
  require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
).href;

// Resolve the standard_fonts directory bundled with pdfjs-dist so that pdfjs
// can load font metrics for PDFs that reference standard Type 1 fonts
// (Helvetica, Times-Roman, Courier, etc.). Without this, pdfjs logs a warning
// for every such PDF and falls back to less accurate width tables.
const PDFJS_STANDARD_FONT_URL = pathToFileURL(
  path.join(
    path.dirname(require.resolve('pdfjs-dist/package.json')),
    'standard_fonts',
    path.sep, // trailing slash — pdfjs appends filenames directly
  ),
).href;

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
    const doc = await pdfjsLib.getDocument({
      data,
      standardFontDataUrl: PDFJS_STANDARD_FONT_URL,
    }).promise;

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
