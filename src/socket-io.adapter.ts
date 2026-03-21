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
      // Default Engine.IO path; keep explicit so it matches socket.io-client defaults
      path: '/socket.io',
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
      perMessageDeflate: false,
      // Handshake can exceed default during Cloud Run cold start
      connectTimeout: 45_000,
      pingTimeout: 60_000,
      pingInterval: 25_000,
    });
  }
}
