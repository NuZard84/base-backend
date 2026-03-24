import { Injectable } from '@nestjs/common';
import { ChunkingStrategy } from '@prisma/client';
import {
  IChunkingStrategy,
  ChunkInput,
  estimateTokens,
} from './chunking-strategy.interface';

/**
 * Semantic chunking — splits on sentence/paragraph boundaries.
 * Groups sentences into windows of ~targetTokens.
 * Never cuts mid-sentence; uses overlap of ~overlapTokens from the previous window.
 *
 * Best for: text-heavy PDFs, long prose documents.
 */
@Injectable()
export class SemanticStrategy implements IChunkingStrategy {
  readonly name = ChunkingStrategy.SEMANTIC;

  private readonly targetTokens: number;
  private readonly overlapTokens: number;
  private readonly maxTokens: number;

  constructor(targetTokens = 800, overlapTokens = 50, maxTokens = 1000) {
    this.targetTokens = targetTokens;
    this.overlapTokens = overlapTokens;
    this.maxTokens = maxTokens;
  }

  chunk(text: string): ChunkInput[] {
    const normalized = text.replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];

    const sentences = this.splitSentences(normalized);
    const chunks: ChunkInput[] = [];
    let buffer: string[] = [];
    let bufferTokens = 0;
    let index = 0;

    for (const sentence of sentences) {
      const sentTokens = estimateTokens(sentence);

      // Single sentence exceeds max — force-add it as its own chunk
      if (sentTokens > this.maxTokens) {
        if (buffer.length > 0) {
          chunks.push(this.makeChunk(buffer, index++));
          buffer = this.overlapSlice(buffer);
          bufferTokens = estimateTokens(buffer.join(' '));
        }
        chunks.push(this.makeChunk([sentence], index++));
        buffer = [];
        bufferTokens = 0;
        continue;
      }

      // Would overflow — flush buffer, start new with overlap
      if (bufferTokens + sentTokens > this.targetTokens && buffer.length > 0) {
        chunks.push(this.makeChunk(buffer, index++));
        buffer = this.overlapSlice(buffer);
        bufferTokens = estimateTokens(buffer.join(' '));
      }

      buffer.push(sentence);
      bufferTokens += sentTokens;
    }

    // Flush remaining
    if (buffer.length > 0) {
      chunks.push(this.makeChunk(buffer, index));
    }

    return chunks;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private splitSentences(text: string): string[] {
    // Split on:  .  !  ?  followed by whitespace + capital  OR  blank line (paragraph)
    const raw = text.split(/(?<=[.!?])\s+(?=[A-Z])|(?:\n\s*\n+)/);
    return raw.map((s) => s.trim()).filter((s) => s.length > 0);
  }

  /** Keep the last N sentences as overlap context for the next chunk */
  private overlapSlice(sentences: string[]): string[] {
    let tokens = 0;
    const overlap: string[] = [];
    for (let i = sentences.length - 1; i >= 0; i--) {
      const t = estimateTokens(sentences[i]);
      if (tokens + t > this.overlapTokens) break;
      overlap.unshift(sentences[i]);
      tokens += t;
    }
    return overlap;
  }

  private makeChunk(sentences: string[], index: number): ChunkInput {
    const content = sentences.join(' ').trim();
    return {
      chunkIndex: index,
      content,
      tokenCount: estimateTokens(content),
      charCount: content.length,
      strategy: this.name,
    };
  }
}
