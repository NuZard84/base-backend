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

  onModuleInit() {
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
      password: process.env.REDIS_PASSWORD,
      retryStrategy: (times) => Math.min(times * 50, 2000),
      connectTimeout: 5000,
      maxRetriesPerRequest: 2,
    });

    this.redis.on('connect', () => this.logger.log('Redis connected'));
    this.redis.on('error', (err) => this.logger.error('Redis error:', err));
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

  onModuleDestroy() {
    if (this.redis) {
      this.redis.quit();
      this.logger.log('Redis disconnected');
    }
  }
}
