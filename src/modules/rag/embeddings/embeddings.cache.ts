import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { RedisService } from '../../../redis/redis.service';

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const KEY_PREFIX = 'embed:v1:';

@Injectable()
export class EmbeddingsCache {
  private readonly logger = new Logger(EmbeddingsCache.name);

  constructor(private readonly redis: RedisService) {}

  /** Stable cache key: SHA-256 of (model + text) */
  private cacheKey(model: string, text: string): string {
    const hash = createHash('sha256').update(`${model}:${text}`).digest('hex');
    return `${KEY_PREFIX}${hash}`;
  }

  async get(model: string, text: string): Promise<number[] | null> {
    try {
      const raw = await this.redis.get(this.cacheKey(model, text));
      if (!raw) return null;
      return JSON.parse(raw) as number[];
    } catch {
      // Redis unavailable or parse error — treat as cache miss, don't block pipeline
      return null;
    }
  }

  async set(model: string, text: string, embedding: number[]): Promise<void> {
    try {
      await this.redis.set(
        this.cacheKey(model, text),
        JSON.stringify(embedding),
        CACHE_TTL_SECONDS,
      );
    } catch (err) {
      // Cache write failure is non-fatal
      this.logger.warn(`Cache write failed: ${err?.message}`);
    }
  }

  /** Lookup many texts at once; returns a Map<text, embedding | null> */
  async getMany(model: string, texts: string[]): Promise<Map<string, number[] | null>> {
    const result = new Map<string, number[] | null>();
    await Promise.all(
      texts.map(async (text) => {
        result.set(text, await this.get(model, text));
      }),
    );
    return result;
  }

  async setMany(model: string, pairs: { text: string; embedding: number[] }[]): Promise<void> {
    await Promise.all(pairs.map(({ text, embedding }) => this.set(model, text, embedding)));
  }
}
