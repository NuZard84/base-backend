import { IoAdapter } from '@nestjs/platform-socket.io';
import { INestApplication } from '@nestjs/common';
import type { ServerOptions } from 'socket.io';

/**
 * Custom Socket.IO adapter that applies server-level configuration correctly.
 *
 * Why this exists:
 * - `transports`, `cors`, `pingInterval`, `pingTimeout` are Socket.IO *server*
 *   options. Putting them in @WebSocketGateway() applies them to the namespace
 *   instead, which Socket.IO ignores or mishandles — causing "Invalid namespace".
 * - Cloud Run terminates idle HTTP connections at 60 s, so pingInterval must
 *   be shorter than that. Pure WebSocket connections are not affected by the
 *   HTTP timeout, but the ping keepalive still prevents Cloud Run from tearing
 *   down the TCP connection.
 */
export class SocketIoAdapter extends IoAdapter {
    private readonly corsOrigin: string[] | boolean;

    constructor(app: INestApplication) {
        super(app);
        const frontendUrl = process.env.FRONTEND_URL;
        this.corsOrigin = frontendUrl
            ? frontendUrl.split(',').map((u) => u.trim())
            : process.env.NODE_ENV === 'production'
              ? false   // no FRONTEND_URL in prod = misconfiguration, block all
              : true;   // dev: allow all
    }

    createIOServer(port: number, options?: ServerOptions) {
        return super.createIOServer(port, {
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
        });
    }
}
