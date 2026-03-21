import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

/**
 * Socket.io bound to Nest's HTTP server with explicit CORS + timeouts.
 * Cloud Run and some proxies are sensitive to WS upgrade + CORS; JWT still gates access in CanvasesGateway.
 */
export class SocketIoAdapter extends IoAdapter {
  constructor(app: INestApplication) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): any {
    return super.createIOServer(port, {
      ...options,
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
      perMessageDeflate: false,
      pingTimeout: 60_000,
      pingInterval: 25_000,
    });
  }
}
