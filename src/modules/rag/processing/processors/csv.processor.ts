import { Injectable, Logger } from '@nestjs/common';
import * as Papa from 'papaparse';

export interface CsvResult {
  text: string;
  rowCount: number;
  headers: string[];
  rows: Record<string, string>[];
}

@Injectable()
export class CsvProcessorHelper {
  private readonly logger = new Logger(CsvProcessorHelper.name);

  async extract(buffer: Buffer, filename: string): Promise<CsvResult> {
    this.logger.log(`Extracting data from CSV: ${filename}`);
    const csvString = buffer.toString('utf-8');

    const result = Papa.parse<Record<string, string>>(csvString, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
    });

    const headers = result.meta.fields ?? [];
    const rows = result.data;
    const rowCount = rows.length;

    // Build a compact text representation for embedding
    const lines = [
      `File: ${filename}`,
      `Columns: ${headers.join(', ')}`,
      `Total rows: ${rowCount}`,
    ];
    rows.forEach((row, i) => {
      lines.push(`Row ${i + 1}: ${headers.map((h) => `${h}=${row[h] ?? ''}`).join(' | ')}`);
    });

    return { text: lines.join('\n'), rowCount, headers, rows };
  }
}
