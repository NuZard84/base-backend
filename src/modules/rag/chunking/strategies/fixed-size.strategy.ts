import { Injectable } from '@nestjs/common';
import { ChunkingStrategy } from '@prisma/client';
import {
  IChunkingStrategy,
  ChunkInput,
  estimateTokens,
} from './chunking-strategy.interface';

/**
 * Fixed-size chunking with character overlap.
 * Splits text into windows of ~targetTokens with overlapTokens overlap.
 * Used for: images (OCR output) and dense PDFs without clear structure.
 */
@Injectable()
export class FixedSizeStrategy implements IChunkingStrategy {
  readonly name = ChunkingStrategy.FIXED_SIZE;

  /** Target chunk size in tokens (≈ chars / 4) */
  private readonly targetChars: number;
  /** Overlap between consecutive chunks in chars */
  private readonly overlapChars: number;

  constructor(targetTokens = 512, overlapTokens = 50) {
    if (overlapTokens >= targetTokens) {
      throw new Error(
        `FixedSizeStrategy: overlapTokens (${overlapTokens}) must be less than targetTokens (${targetTokens})`,
      );
    }
    this.targetChars = targetTokens * 4;
    this.overlapChars = overlapTokens * 4;
  }

  chunk(text: string): ChunkInput[] {
    const normalized = text.replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];

    const chunks: ChunkInput[] = [];
    let start = 0;
    let index = 0;

    while (start < normalized.length) {
      const end = Math.min(start + this.targetChars, normalized.length);
      const content = normalized.slice(start, end).trim();

      if (content) {
        chunks.push({
          chunkIndex: index++,
          content,
          tokenCount: estimateTokens(content),
          charCount: content.length,
          strategy: this.name,
        });
      }

      // Advance by target minus overlap so consecutive chunks share context
      start += this.targetChars - this.overlapChars;
    }

    return chunks;
  }
}
