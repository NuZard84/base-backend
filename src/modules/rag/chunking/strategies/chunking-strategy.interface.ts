import { ChunkingStrategy } from '@prisma/client';

export interface ChunkInput {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  charCount: number;
  pageNumber?: number;
  rowRange?: string;
  strategy: ChunkingStrategy;
}

export interface IChunkingStrategy {
  readonly name: ChunkingStrategy;
  chunk(text: string, meta?: Record<string, unknown>): ChunkInput[];
}

/** Simple token estimate: 1 token ≈ 4 chars (English) */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
