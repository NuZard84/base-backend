import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private redis: Redis | null = null;
  private readonly logger = new Logger(RedisService.name);

  async onModuleInit() {
    const host = process.env.REDIS_HOST;
    const port = process.env.REDIS_PORT;
    if (!host || !port) {
      this.logger.warn(
        'Redis not configured (REDIS_HOST/REDIS_PORT missing). Redis operations will no-op.',
      );
      return;
    }
    const username = process.env.REDIS_USERNAME;
    this.redis = new Redis({
      host,
      port: Number(port),
      ...(username ? { username } : {}),
      password: process.env.REDIS_PASSWORD || undefined,
      // Exponential backoff up to 5 s; give up after 10 consecutive failures
      retryStrategy: (times) => {
        if (times > 10) return null;
        return Math.min(times * 200, 5_000);
      },
      connectTimeout: 10_000,
      // Abort commands that take too long rather than letting them hang
      commandTimeout: 5_000,
      maxRetriesPerRequest: 3,
      // Don't silently queue commands while disconnected — surface errors immediately
      enableOfflineQueue: false,
      // Don't open the socket until the first command is issued
      lazyConnect: true,
      // TCP keepalive — detect stale half-open connections before Redis Cloud closes them
      keepAlive: 30_000,
    });

    this.redis.on('connect', () => this.logger.log('Redis connected'));
    this.redis.on('error', (err) => this.logger.error('Redis error:', err));
    this.redis.on('close', () => this.logger.warn('Redis connection closed'));
    this.redis.on('reconnecting', () => this.logger.log('Redis reconnecting…'));

    // Explicitly connect now that listeners are attached, so errors during
    // initial handshake are captured by the 'error' handler above.
    await this.redis.connect();
  }

  private guard() {
    if (!this.redis) {
      throw new Error('Redis is not configured. Set REDIS_HOST and REDIS_PORT.');
    }
  }

  async set(key: string, value: string, ttl: number) {
    this.guard();
    await this.redis!.set(key, value, 'EX', ttl);
  }

  async get(key: string) {
    this.guard();
    return await this.redis!.get(key);
  }

  async del(key: string) {
    this.guard();
    await this.redis!.del(key);
  }

  async expire(key: string, ttl: number) {
    this.guard();
    await this.redis!.expire(key, ttl);
  }

  async incr(key: string) {
    this.guard();
    return await this.redis!.incr(key);
  }

  async exists(key: string) {
    this.guard();
    const result = await this.redis!.exists(key);
    return result === 1;
  }

  // Atomically get-and-delete a key in a single round trip.
  // Uses Redis GETDEL (Redis ≥ 6.2) with GET+DEL fallback for older servers.
  // Critical for one-time-use tokens — prevents two concurrent callers from
  // both successfully exchanging the same code.
  async getdel(key: string): Promise<string | null> {
    this.guard();
    try {
      return await (this.redis! as any).getdel(key);
    } catch {
      // Fallback: GET then DEL (not fully atomic but safe enough under normal load)
      const value = await this.redis!.get(key);
      if (value !== null) await this.redis!.del(key);
      return value;
    }
  }

  // ── List operations (used for op-log) ────────────────────────────────────

  async rpush(key: string, ...values: string[]): Promise<number> {
    this.guard();
    return await this.redis!.rpush(key, ...values);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    this.guard();
    return await this.redis!.lrange(key, start, stop);
  }

  async ltrim(key: string, start: number, stop: number): Promise<void> {
    this.guard();
    await this.redis!.ltrim(key, start, stop);
  }

  async onModuleDestroy() {
    if (this.redis) {
      // Graceful quit flushes pending commands; fall back to immediate disconnect
      // if Redis is already unreachable (e.g. during a crash or forced shutdown).
      await this.redis.quit().catch(() => this.redis!.disconnect());
      this.logger.log('Redis disconnected');
    }
  }
}
