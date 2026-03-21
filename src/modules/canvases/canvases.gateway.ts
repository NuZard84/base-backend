import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    ConnectedSocket,
    MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { CanvasSharesService } from './canvas-shares/canvas-shares.service';
import { CanvasCollabService, UserPresence } from './canvas-collab.service';
import { PrismaService } from 'prisma/prisma.service';
import { CanvasRole } from '@prisma/client';
import type {
    CanvasOp,
    CanvasOpPayload,
    CursorMovePayload,
    SelectionChangePayload,
    ForceFlushPayload,
} from './dto/canvas-op.dto';

@WebSocketGateway({
    // Mirror the same origin list as main.ts app.enableCors() so the
    // Socket.IO handshake is not blocked by the Express CORS middleware.
    // Falls back to '*' only in non-production (dev/test).
    cors: {
        origin: process.env.FRONTEND_URL
            ? process.env.FRONTEND_URL.split(',').map((u) => u.trim())
            : process.env.NODE_ENV === 'production'
              ? false
              : '*',
        credentials: true,
    },
    namespace: 'canvases',
    // Polling first, then WebSocket upgrade (must match client). WebSocket-only server rejects polling → "Transport unknown".
    transports: ['polling', 'websocket'],
})
export class CanvasesGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(CanvasesGateway.name);

    constructor(
        private jwtService: JwtService,
        private configService: ConfigService,
        private canvasSharesService: CanvasSharesService,
        private collabService: CanvasCollabService,
        private prisma: PrismaService,
    ) {}

    // ── Connection lifecycle ──────────────────────────────────────────────────

    async handleConnection(client: Socket) {
        try {
            const token =
                client.handshake.auth?.token ||
                client.handshake.headers['authorization']?.split(' ')[1];
            if (!token) { client.disconnect(); return; }

            const payload = this.jwtService.verify(token, {
                secret: this.configService.get<string>('JWT_SECRET'),
            });

            client.data.userId = payload.sub as string;
            client.data.canvasIds = new Set<string>();
            this.logger.log(`Connected: ${client.id} (user=${payload.sub})`);
        } catch (e) {
            this.logger.warn(`Auth failed for ${client.id}: ${e.message}`);
            client.disconnect();
        }
    }

    async handleDisconnect(client: Socket) {
        const userId = client.data.userId as string | undefined;
        const canvasIds = client.data.canvasIds as Set<string> | undefined;

        if (userId && canvasIds) {
            for (const canvasId of canvasIds) {
                void this.collabService.removePresence(canvasId, userId);
                void this.collabService.forceFlush(canvasId);
                this.server
                    .to(`canvas:${canvasId}`)
                    .emit('presence_left', { canvasId, userId });
            }
        }
        this.logger.log(`Disconnected: ${client.id}`);
    }

    // ── Room management ───────────────────────────────────────────────────────

    @SubscribeMessage('join_canvas')
    async handleJoinCanvas(
        @ConnectedSocket() client: Socket,
        @MessageBody() canvasId: string,
    ) {
        const userId = client.data.userId as string;
        if (!userId || !canvasId) return;

        try {
            await this.canvasSharesService.ensureCanvasAccess(userId, canvasId, CanvasRole.VIEWER);
        } catch {
            return { event: 'error', data: { message: 'Cannot join canvas room' } };
        }

        const roomName = `canvas:${canvasId}`;
        await client.join(roomName);
        (client.data.canvasIds as Set<string>).add(canvasId);

        // Resolve user name once per join (infrequent)
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { name: true },
        });
        const presence = await this.collabService.setPresence(canvasId, userId, {
            name: user?.name ?? 'Unknown',
        });

        // Send current presence list to the joiner
        const sockets = await this.server.in(roomName).fetchSockets();
        const peerUserIds = sockets
            .map(s => s.data.userId as string)
            .filter(id => id && id !== userId);
        const uniquePeerIds = [...new Set(peerUserIds)];
        const peers = await Promise.all(
            uniquePeerIds.map(id => this.collabService.getPresence(canvasId, id)),
        );
        client.emit('presence_list', {
            canvasId,
            users: peers.filter(Boolean) as UserPresence[],
        });

        // Broadcast joiner's presence to existing peers
        client.broadcast.to(roomName).emit('presence_joined', { canvasId, user: presence });

        this.logger.log(`${client.id} joined canvas:${canvasId}`);
        return { event: 'joined', data: { canvasId } };
    }

    @SubscribeMessage('leave_canvas')
    async handleLeaveCanvas(
        @ConnectedSocket() client: Socket,
        @MessageBody() canvasId: string,
    ) {
        if (!canvasId) return;
        const userId = client.data.userId as string;
        const roomName = `canvas:${canvasId}`;

        await client.leave(roomName);
        (client.data.canvasIds as Set<string>).delete(canvasId);

        void this.collabService.removePresence(canvasId, userId);
        void this.collabService.forceFlush(canvasId);

        this.server.to(roomName).emit('presence_left', { canvasId, userId });
        this.logger.log(`${client.id} left canvas:${canvasId}`);
    }

    // ── Real-time op relay (no DB, sub-millisecond path) ─────────────────────

    /**
     * Relay a canvas op (node_move, node_resize, node_style, node_zindex) to peers
     * AND queue it for debounced DB persistence (every 500 ms).
     *
     * Client sends: { canvasId, op: CanvasOp }
     * Peers receive: 'op_relayed' { canvasId, senderUserId, op }
     */
    @SubscribeMessage('canvas_op')
    handleCanvasOp(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: CanvasOpPayload,
    ) {
        const userId = client.data.userId as string;
        if (!userId || !payload?.canvasId || !payload?.op) return;

        const { canvasId, op } = payload;

        // 1. Relay to peers immediately — before any async work
        client.broadcast.to(`canvas:${canvasId}`).emit('op_relayed', {
            canvasId,
            senderUserId: userId,
            op,
        });

        // 2. Queue for debounced DB write (fire-and-forget, non-blocking)
        this.collabService.queueOp(canvasId, op);
    }

    /**
     * Relay cursor position to peers.
     * Cursor updates are ephemeral: no DB write, no Redis — just relay.
     * High-frequency (~60fps), so we keep this as lean as possible.
     *
     * Client sends: { canvasId, x, y }
     * Peers receive: 'cursor_updated' { canvasId, userId, x, y }
     */
    @SubscribeMessage('cursor_move')
    handleCursorMove(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: CursorMovePayload,
    ) {
        const userId = client.data.userId as string;
        if (!userId || !payload?.canvasId) return;

        client.broadcast.to(`canvas:${payload.canvasId}`).emit('cursor_updated', {
            canvasId: payload.canvasId,
            userId,
            x: payload.x,
            y: payload.y,
        });
    }

    /**
     * Relay selection changes to peers and update presence in Redis.
     *
     * Client sends: { canvasId, selectedNodeIds }
     * Peers receive: 'selection_updated' { canvasId, userId, selectedNodeIds }
     */
    @SubscribeMessage('selection_change')
    handleSelectionChange(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: SelectionChangePayload,
    ) {
        const userId = client.data.userId as string;
        if (!userId || !payload?.canvasId) return;

        // Relay to peers immediately
        client.broadcast.to(`canvas:${payload.canvasId}`).emit('selection_updated', {
            canvasId: payload.canvasId,
            userId,
            selectedNodeIds: payload.selectedNodeIds,
        });

        // Update presence async (non-blocking)
        void this.collabService.setPresence(payload.canvasId, userId, {
            selectedNodeIds: payload.selectedNodeIds,
        });
    }

    /**
     * Force-flush pending DB writes for a canvas.
     * Call this on mouse-up / commit to ensure final state is persisted without waiting for timer.
     *
     * Client sends: { canvasId }
     */
    @SubscribeMessage('canvas_force_flush')
    async handleForceFlush(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: ForceFlushPayload,
    ) {
        const userId = client.data.userId as string;
        if (!userId || !payload?.canvasId) return;

        await this.collabService.forceFlush(payload.canvasId);
        return { event: 'flushed', data: { canvasId: payload.canvasId } };
    }

    // ── Called by CanvasesService after HTTP sync ─────────────────────────────

    /**
     * Broadcast the result of an HTTP sync (structural changes: create/delete nodes/edges).
     * Sends only the delta needed by collaborators; nodeIdMap is returned via HTTP to the sender.
     */
    broadcastCanvasUpdate(
        canvasId: string,
        payload: {
            delta?: {
                nodesUpdated?: unknown[];
                nodesDeleted?: string[];
                edgesAdded?: unknown[];
                edgesDeleted?: string[];
            };
            nodeCount?: number;
            edgeCount?: number;
        },
        senderUserId?: string,
    ) {
        this.server.to(`canvas:${canvasId}`).emit('canvas_updated', {
            canvasId,
            senderUserId,
            delta: payload.delta ?? null,
            nodeCount: payload.nodeCount,
            edgeCount: payload.edgeCount,
        });
    }
}
