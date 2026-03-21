import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type Redis from 'ioredis';

/**
 * WebSocket adapter that uses Redis for cross-instance Socket.IO broadcast.
 * Required for Cloud Run (or any multi-instance) deployment so WebSocket
 * packets reach clients on any instance.
 */
export class RedisIoAdapter extends IoAdapter {
  constructor(
    appOrHttpServer: any,
    private readonly pubClient: Redis,
    private readonly subClient: Redis,
  ) {
    super(appOrHttpServer);
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    server.adapter(createAdapter(this.pubClient, this.subClient));
    return server;
  }
}
