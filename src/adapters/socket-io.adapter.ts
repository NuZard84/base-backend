import { IoAdapter } from '@nestjs/platform-socket.io';
import { INestApplication } from '@nestjs/common';
import type { ServerOptions } from 'socket.io';
import type { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

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
 *
 * Redis adapter:
 * - Attaches @socket.io/redis-adapter when REDIS_HOST is configured.
 * - Enables multi-instance WebSocket broadcasting — if Cloud Run scales beyond
 *   1 instance, users on different instances can still receive each other's ops.
 * - Uses two separate IORedis clients (pub + sub) as required by the adapter.
 * - Gracefully skips adapter setup if Redis is not configured (dev / no-Redis env).
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

        // Attach Redis pub/sub adapter for multi-instance WebSocket support.
        // Requires two separate Redis clients — the sub client enters subscribe
        // mode and can no longer issue regular commands, so it must be isolated.
        const redisHost = process.env.REDIS_HOST;
        const redisPort = parseInt(process.env.REDIS_PORT ?? '6379', 10);
        const redisPassword = process.env.REDIS_PASSWORD || undefined;
        const redisUsername = process.env.REDIS_USERNAME || undefined;

        if (redisHost) {
            // Pub/sub clients must NOT use lazyConnect or disableOfflineQueue.
            // The Redis adapter calls psubscribe immediately after creation —
            // lazyConnect delays the connection so the socket isn't open yet,
            // and enableOfflineQueue:false then rejects the command outright.
            // Let them connect eagerly and queue commands while connecting.
            const redisOpts = {
                host: redisHost,
                port: redisPort,
                ...(redisPassword && { password: redisPassword }),
                ...(redisUsername && { username: redisUsername }),
                retryStrategy: (times: number) => Math.min(times * 200, 5_000),
                connectTimeout: 10_000,
                keepAlive: 30_000,
            };
            const pubClient = new Redis(redisOpts);
            const subClient = pubClient.duplicate();

            pubClient.on('error', (err) => console.error('[Socket.IO Redis pub]', err));
            subClient.on('error', (err) => console.error('[Socket.IO Redis sub]', err));

            this.cachedServer.adapter(createAdapter(pubClient, subClient));
        }

        return this.cachedServer;
    }
}
