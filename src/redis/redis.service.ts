import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private redis: Redis;
  private readonly logger = new Logger(RedisService.name);

  onModuleInit() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT),
      password: process.env.REDIS_PASSWORD,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });

    this.redis.on('connect', () => this.logger.log('Redis connected'));
    this.redis.on('error', (err) => this.logger.error('Redis error:', err));
  }

  async set(key: string, value: string, ttl: number) {
    await this.redis.set(key, value, 'EX', ttl);
  }

  async get(key: string) {
    return await this.redis.get(key);
  }

  async del(key: string) {
    await this.redis.del(key);
  }

  async expire(key: string, ttl: number) {
    await this.redis.expire(key, ttl);
  }

  async incr(key: string) {
    return await this.redis.incr(key);
  }

  async exists(key: string) {
    const result = await this.redis.exists(key);
    return result === 1;
  }

  onModuleDestroy() {
    this.redis.quit();
    this.logger.log('Redis disconnected');
  }
}
