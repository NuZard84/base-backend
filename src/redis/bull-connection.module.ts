import { Global, Inject, Module, OnModuleDestroy, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';

export const BULL_REDIS_CONNECTION = Symbol('BULL_REDIS_CONNECTION');

const bullConnectionProvider: Provider = {
  provide: BULL_REDIS_CONNECTION,
  inject: [ConfigService],
  useFactory: (config: ConfigService): IORedis => {
    // Fall back to localhost defaults so local dev without Redis env vars doesn't
    // crash at module init (same behaviour as the previous per-queue config objects).
    const host = config.get<string>('REDIS_HOST', 'localhost');
    const port = config.get<number>('REDIS_PORT', 6379);

    return new IORedis({
      host,
      port,
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      username: config.get<string>('REDIS_USERNAME') || undefined,
      // Required by BullMQ — blocking commands like BRPOPLPUSH have no retry limit
      maxRetriesPerRequest: null,
      // Don't queue commands while disconnected; fail fast so callers see errors
      enableOfflineQueue: false,
      connectTimeout: 10_000,
      // Keep the TCP connection alive to detect stale connections early
      keepAlive: 30_000,
      retryStrategy: (times) => {
        if (times > 10) return null; // Give up — let BullMQ surface the error
        return Math.min(times * 200, 5_000);
      },
    });
  },
};

/**
 * Provides a single shared IORedis instance for all BullMQ Queues.
 *
 * Why a shared instance matters: BullMQ's default behavior is to create one
 * Redis connection per Queue and two per Worker (a client + a blocking client).
 * With 4 queues that's 12 connections per server instance — enough to exhaust
 * Redis Cloud's connection limit when running multiple Cloud Run replicas.
 *
 * Passing an existing IORedis instance as `connection` tells BullMQ to treat it
 * as shared (it will not close it). All Queue client connections are multiplexed
 * through this single socket; Workers still create their own blocking client
 * (unavoidable — needed for BRPOPLPUSH), so the floor is 1 shared + N workers.
 *
 * This module is @Global so the token is importable by AppModule without
 * needing to re-import it everywhere.
 */
@Global()
@Module({
  providers: [bullConnectionProvider],
  exports: [BULL_REDIS_CONNECTION],
})
export class BullConnectionModule implements OnModuleDestroy {
  constructor(
    @Inject(BULL_REDIS_CONNECTION) private readonly conn: IORedis,
  ) {}

  async onModuleDestroy() {
    // Graceful quit first; fall back to immediate disconnect if Redis is already gone
    await this.conn.quit().catch(() => this.conn.disconnect());
  }
}
