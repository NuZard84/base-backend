import { IoAdapter } from '@nestjs/platform-socket.io';
import { INestApplication } from '@nestjs/common';
import type { ServerOptions } from 'socket.io';
import type { Server } from 'socket.io';

/**
 * Custom Socket.IO adapter that applies server-level configuration correctly.
 *
 * Why this exists:
 * - `transports`, `cors`, `pingInterval`, `pingTimeout` are Socket.IO *server*
 *   options. Putting them in @WebSocketGateway() applies them to the namespace
 *   instead, causing "Invalid namespace" errors.
 * - Without caching the server instance, NestJS can call createIOServer()
 *   multiple times, producing separate Socket.IO instances on the same HTTP
 *   server. Namespaces registered on the second instance are never reachable
 *   because the first instance wins the HTTP upgrade event — resulting in
 *   "Invalid namespace" for every non-default namespace.
 * - Cloud Run terminates idle HTTP connections at 60 s; pingInterval must be
 *   shorter than that to keep WebSocket connections alive.
 */
export class SocketIoAdapter extends IoAdapter {
    private readonly corsOrigin: string[] | boolean;
    private cachedServer: Server | null = null;

    constructor(app: INestApplication) {
        // Pass the raw HTTP server so AbstractWsAdapter sets this.httpServer
        // correctly regardless of NestApplication vs INestApplication typing.
        super(app.getHttpServer());
        const frontendUrl = process.env.FRONTEND_URL;
        this.corsOrigin = frontendUrl
            ? frontendUrl.split(',').map((u) => u.trim())
            : process.env.NODE_ENV === 'production'
              ? false   // no FRONTEND_URL in prod = misconfiguration, block all
              : true;   // dev: allow all
    }

    createIOServer(port: number, options?: ServerOptions): Server {
        // Return the cached instance so every namespace is registered on the
        // same Socket.IO server that handles incoming WebSocket connections.
        if (this.cachedServer) return this.cachedServer;

        this.cachedServer = super.createIOServer(port, {
            ...options,
            cors: {
                origin: this.corsOrigin,
                credentials: true,
            },
            // Skip polling: Cloud Run's 60 s HTTP timeout kills long-poll
            // connections and without sticky sessions they break across instances.
            transports: ['websocket'],
            // Keep connections alive under Cloud Run's idle timeout
            pingInterval: 25000,
            pingTimeout: 20000,
        }) as Server;

        return this.cachedServer;
    }
}
