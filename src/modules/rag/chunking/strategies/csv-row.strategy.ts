import { Injectable } from '@nestjs/common';
import { ChunkingStrategy } from '@prisma/client';
import * as Papa from 'papaparse';
import {
  IChunkingStrategy,
  ChunkInput,
  estimateTokens,
} from './chunking-strategy.interface';

/**
 * CSV row-based chunking.
 * Groups rows into windows of `rowsPerChunk`.
 * The header row is repeated at the top of every chunk so each chunk is self-contained.
 *
 * Best for: CSV / tabular data.
 */
@Injectable()
export class CsvRowStrategy implements IChunkingStrategy {
  readonly name = ChunkingStrategy.CSV_ROW;

  private readonly rowsPerChunk: number;

  constructor(rowsPerChunk = 20) {
    this.rowsPerChunk = rowsPerChunk;
  }

  chunk(text: string, meta?: Record<string, unknown>): ChunkInput[] {
    const result = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
    });

    const headers = result.meta.fields ?? [];
    const rows = result.data;
    const totalRows = rows.length;
    const chunks: ChunkInput[] = [];

    for (let i = 0; i < rows.length; i += this.rowsPerChunk) {
      const batch = rows.slice(i, i + this.rowsPerChunk);
      const rowStart = i + 1;
      const rowEnd = Math.min(i + this.rowsPerChunk, rows.length);

      // Re-serialise this slice back to CSV so it's readable + embeddable
      const csvSlice = Papa.unparse({ fields: headers, data: batch });

      // Build a natural language summary so embeddings match conversational queries
      const summary = this.buildBatchSummary(headers, batch, rowStart, rowEnd, totalRows);

      const content = `${summary}\n\nRaw data (rows ${rowStart}-${rowEnd}):\n${csvSlice}`;

      chunks.push({
        chunkIndex: chunks.length,
        content,
        tokenCount: estimateTokens(content),
        charCount: content.length,
        rowRange: `${rowStart}-${rowEnd}`,
        strategy: this.name,
      });
    }

    return chunks;
  }

  /**
   * Generates a short natural language summary of a batch of rows.
   * This dramatically improves embedding similarity to conversational queries.
   */
  private buildBatchSummary(
    headers: string[],
    batch: Record<string, string>[],
    rowStart: number,
    rowEnd: number,
    totalRows: number,
  ): string {
    const lines: string[] = [
      `This is a section (rows ${rowStart}-${rowEnd} of ${totalRows}) from a CSV spreadsheet with ${headers.length} columns: ${headers.join(', ')}.`,
    ];

    // Sample unique values for each column to give semantic context
    for (const col of headers.slice(0, 8)) {
      const values = [...new Set(batch.map((r) => r[col]?.trim()).filter(Boolean))];
      if (values.length === 0) continue;
      const sample = values.slice(0, 5).join(', ');
      const suffix = values.length > 5 ? ` and ${values.length - 5} more` : '';
      lines.push(`Column "${col}" contains values like: ${sample}${suffix}.`);
    }

    return lines.join('\n');
  }
}
