import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { EmbeddingsCache } from './embeddings.cache';

/** Gemini gemini-embedding-001; stored dim must be ≤2000 for pgvector HNSW (see outputDimensionality). */
export const EMBEDDING_MODEL = 'gemini-embedding-001';
/** MRL output size — 1536 is under pgvector's HNSW limit (2000); full model default is 3072. */
export const EMBEDDING_DIMENSIONS = 1536;
/** Redis cache namespace — include dim so 768/3072 cache entries never mix. */
export const EMBEDDING_CACHE_KEY = `${EMBEDDING_MODEL}:dim${EMBEDDING_DIMENSIONS}`;
/** Max texts per Gemini batch request */
const GEMINI_BATCH_SIZE = 100;

export type EmbedTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

export interface EmbedResult {
  text: string;
  embedding: number[];
  fromCache: boolean;
}

@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);
  private genAI: GoogleGenAI | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly cache: EmbeddingsCache,
  ) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (apiKey) {
      // Default API version is v1beta — required for embedContent (gemini-embedding-001);
      // forcing v1 returns NOT_FOUND for embedding models.
      this.genAI = new GoogleGenAI({ apiKey });
    } else {
      this.logger.warn('GEMINI_API_KEY not set — EmbeddingsService inactive');
    }
  }

  /**
   * Embed a single text. Uses the cache first.
   * taskType: RETRIEVAL_DOCUMENT for storing chunks, RETRIEVAL_QUERY for user queries.
   */
  async embedOne(text: string, taskType: EmbedTaskType = 'RETRIEVAL_DOCUMENT'): Promise<number[]> {
    const results = await this.embedBatch([text], taskType);
    return results[0].embedding;
  }

  /**
   * Embed many texts efficiently.
   * 1. Check cache for all texts.
   * 2. Batch-call Gemini only for cache misses (up to 100/request).
   * 3. Persist new embeddings to cache.
   */
  async embedBatch(
    texts: string[],
    taskType: EmbedTaskType = 'RETRIEVAL_DOCUMENT',
  ): Promise<EmbedResult[]> {
    if (!this.genAI) {
      throw new Error('Gemini API key not configured — cannot generate embeddings');
    }
    if (texts.length === 0) return [];

    // 1. Cache lookup
    const cacheMap = await this.cache.getMany(EMBEDDING_CACHE_KEY, texts);
    const misses: { idx: number; text: string }[] = [];

    texts.forEach((text, idx) => {
      if (!cacheMap.get(text)) misses.push({ idx, text });
    });

    this.logger.debug(
      `embedBatch: ${texts.length} total, ${cacheMap.size - misses.length} cache hits, ${misses.length} misses`,
    );

    // 2. Fetch uncached embeddings from Gemini in batches of GEMINI_BATCH_SIZE
    const freshEmbeddings = new Map<string, number[]>();

    for (let i = 0; i < misses.length; i += GEMINI_BATCH_SIZE) {
      const batch = misses.slice(i, i + GEMINI_BATCH_SIZE);
      const batchTexts = batch.map((m) => m.text);

      const response = await this.genAI.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: batchTexts,
        config: { taskType, outputDimensionality: EMBEDDING_DIMENSIONS },
      });

      const embeddings = response.embeddings ?? [];
      if (embeddings.length !== batchTexts.length) {
        throw new Error(
          `Gemini returned ${embeddings.length} embeddings for ${batchTexts.length} inputs`,
        );
      }

      batch.forEach(({ text }, j) => {
        const values = embeddings[j]?.values;
        if (!values || values.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(
            `Unexpected embedding dimension: got ${values?.length}, expected ${EMBEDDING_DIMENSIONS}`,
          );
        }
        freshEmbeddings.set(text, values);
      });

      this.logger.log(`Embedded batch ${i / GEMINI_BATCH_SIZE + 1}: ${batch.length} texts`);
    }

    // 3. Write fresh embeddings to cache
    if (freshEmbeddings.size > 0) {
      await this.cache.setMany(
        EMBEDDING_CACHE_KEY,
        [...freshEmbeddings.entries()].map(([text, embedding]) => ({ text, embedding })),
      );
    }

    // 4. Assemble ordered results
    return texts.map((text) => {
      const cached = cacheMap.get(text);
      if (cached) return { text, embedding: cached, fromCache: true };
      const fresh = freshEmbeddings.get(text);
      if (fresh) return { text, embedding: fresh, fromCache: false };
      throw new Error(`No embedding produced for text: "${text.slice(0, 50)}..."`);
    });
  }
}
