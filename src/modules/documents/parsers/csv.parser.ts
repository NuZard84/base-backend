import { Injectable, Logger } from '@nestjs/common';
import { ParsedFileContent } from '../../ai-model-api/providers/ai-provider.interface';
import * as Papa from 'papaparse';

@Injectable()
export class CsvParser {
  private readonly logger = new Logger(CsvParser.name);

  /** Max rows included in the text sent to AI (prevents token overflow) */
  private readonly MAX_ROWS_FOR_SUMMARY = 200;

  async parse(buffer: Buffer, filename: string): Promise<ParsedFileContent> {
    this.logger.log(`Parsing CSV: ${filename}`);
    const csvString = buffer.toString('utf-8');

    const result = Papa.parse<Record<string, string>>(csvString, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
    });

    const rows = result.data;
    const headers = result.meta.fields ?? [];
    const totalRows = rows.length;
    const previewRows = rows.slice(0, this.MAX_ROWS_FOR_SUMMARY);

    // Build a human-readable text representation
    const lines = [
      `CSV File: ${filename}`,
      `Columns (${headers.length}): ${headers.join(', ')}`,
      `Total rows: ${totalRows}`,
      totalRows > this.MAX_ROWS_FOR_SUMMARY
        ? `(Showing first ${this.MAX_ROWS_FOR_SUMMARY} rows)`
        : '',
      '',
      '--- DATA ---',
      ...previewRows.map((row, i) =>
        `Row ${i + 1}: ${headers.map((h) => `${h}=${row[h] ?? ''}`).join(' | ')}`,
      ),
    ].filter((l) => l !== undefined);

    return {
      text: lines.join('\n'),
      mimeType: 'text/csv',
      filename,
      fileType: 'CSV',
      meta: {
        headers,
        totalRows,
        rowsIncluded: previewRows.length,
        parseErrors: result.errors.length,
      },
    };
  }
}
